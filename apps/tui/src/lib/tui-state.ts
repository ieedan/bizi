/**
 * The TUI's state machine, with no renderer attached.
 *
 * `index.tsx` owns a single `TuiState` and forwards keystrokes and server
 * events into the `apply*` functions below, then performs the effects they
 * return. Keeping it here means every interactive behavior is reachable from a
 * test, and lets the Rust client be held to the same shared conformance cases
 * in `tests/spec/tui-keys.json`.
 *
 * Every `apply*` function mutates the state it is given and returns the effects
 * the caller must perform. That mirrors the Rust `App` so the two clients stay
 * easy to diff.
 */
import type { Task, TaskRunLogLine, TaskRunTreeNode } from "@getbizi/client";
import type {
	DisplayTaskStatus,
	LogMode,
	TaskRow,
	TaskTreeNode,
} from "../types";
import {
	isJumpParentsBackwardShortcut,
	isJumpParentsForwardShortcut,
} from "./keyboard-shortcuts";
import {
	buildDisplayStatusByTaskKey,
	canCancelRun,
	indexRunsByTaskKey,
	upsertRunTreeNode,
} from "./task-runs";
import {
	buildTaskTree,
	findNextParentTaskIndex,
	findPreviousParentTaskIndex,
	flattenTaskRows,
} from "./task-structure";
import {
	canToggleLogMode,
	clampSelectedIndex,
	resolveRowAction,
	runningTaskRows,
	type RunningTaskRow,
	usesAggregateLogs,
} from "./view-state";

export type Pane = "tasks" | "logs";

export type QuitConfirmationAction = "cancelAll" | "exitWithoutCancelling";

export const QUIT_ACTIONS: {
	label: string;
	action: QuitConfirmationAction;
}[] = [
	{ label: "Cancel All [y/q]", action: "cancelAll" },
	{ label: "Exit without cancelling [n]", action: "exitWithoutCancelling" },
];

/** The parts of opentui's `ParsedKey` the TUI actually reads. */
export interface TuiKey {
	name: string;
	ctrl?: boolean;
	meta?: boolean;
	super?: boolean;
	option?: boolean;
	shift?: boolean;
	sequence?: string;
	eventType?: "press" | "repeat" | "release";
}

export type TuiEffect =
	| { type: "runTask"; taskKey: string }
	| { type: "restartRun"; runId: string }
	| { type: "cancelRun"; runId: string }
	| { type: "cancelRunsBeforeExit"; runIds: string[] }
	| { type: "copySelection" }
	| { type: "quit" }
	| { type: "openRootRunStreams"; runIds: string[] }
	| { type: "closeRootRunStreams" }
	| {
			type: "openSelectedRunStreams";
			runId: string;
			includeChildren: boolean;
	  }
	| { type: "closeSelectedRunStreams" };

export interface TuiState {
	tasks: Record<string, Task>;
	taskRuns: TaskRunTreeNode[];

	// Rebuilt from `tasks`/`taskRuns` — never assigned directly.
	taskTree: TaskTreeNode[];
	taskRows: TaskRow[];
	runByTaskKey: Map<string, TaskRunTreeNode>;
	displayStatusByTaskKey: Map<string, DisplayTaskStatus>;

	selectedIndex: number;
	logs: TaskRunLogLine[];
	logMode: LogMode;
	focusedPane: Pane;

	taskSearchQuery: string;
	isTaskSearchFocused: boolean;
	showTaskSearchError: boolean;

	showQuitConfirmation: boolean;
	quitActionIndex: number;
	isCancellingBeforeExit: boolean;

	errorMessage: string | null;
	copyToastMessage: string | null;
	hasSelection: boolean;
	shouldQuit: boolean;

	/** Which streams are currently open. Owned by `syncSubscriptions`. */
	rootStreamKey: string | null;
	selectedStreamKey: string | null;

	isMacOs: boolean;
}

export function createTuiState(options?: { isMacOs?: boolean }): TuiState {
	return {
		tasks: {},
		taskRuns: [],
		taskTree: [],
		taskRows: [],
		runByTaskKey: new Map(),
		displayStatusByTaskKey: new Map(),
		selectedIndex: 0,
		logs: [],
		logMode: "aggregate",
		focusedPane: "tasks",
		taskSearchQuery: "",
		isTaskSearchFocused: false,
		showTaskSearchError: false,
		showQuitConfirmation: false,
		quitActionIndex: 0,
		isCancellingBeforeExit: false,
		errorMessage: null,
		copyToastMessage: null,
		hasSelection: false,
		shouldQuit: false,
		rootStreamKey: null,
		selectedStreamKey: null,
		isMacOs: options?.isMacOs ?? false,
	};
}

// ------------------------------------------------------------ subscriptions

/**
 * The run ids whose status stream the app follows — the roots of the run tree,
 * sorted so the set is compared by value rather than by arrival order.
 */
export function rootStreamRunIds(state: TuiState): string[] {
	return state.taskRuns.map((run) => run.id).sort();
}

/**
 * Identity of the selected run's log stream. The run's `updatedAt` and
 * `status` are part of it, so a run that reports any change re-opens the
 * stream and takes a fresh snapshot from the server rather than trusting the
 * lines it has already accumulated.
 */
export function selectedStreamKey(state: TuiState): string | null {
	const row = selectedRow(state);
	const run = selectedRun(state);
	if (!(row && run)) {
		return null;
	}
	const includeChildren = selectedUsesAggregateLogs(state);
	return `${run.id}:${run.updatedAt}:${run.status}:${includeChildren}`;
}

/**
 * Brings the open websockets in line with the current state. Call after every
 * state change; it returns the streams to close and open, in that order.
 */
export function syncSubscriptions(state: TuiState): TuiEffect[] {
	const effects: TuiEffect[] = [];

	const rootRunIds = rootStreamRunIds(state);
	const nextRootKey = rootRunIds.length > 0 ? rootRunIds.join("|") : null;
	if (nextRootKey !== state.rootStreamKey) {
		if (state.rootStreamKey !== null) {
			effects.push({ type: "closeRootRunStreams" });
		}
		state.rootStreamKey = nextRootKey;
		if (nextRootKey !== null) {
			effects.push({ type: "openRootRunStreams", runIds: rootRunIds });
		}
	}

	const nextSelectedKey = selectedStreamKey(state);
	if (nextSelectedKey !== state.selectedStreamKey) {
		if (state.selectedStreamKey !== null) {
			effects.push({ type: "closeSelectedRunStreams" });
		}
		state.selectedStreamKey = nextSelectedKey;
		if (nextSelectedKey === null) {
			state.logs = [];
		} else {
			const run = selectedRun(state);
			if (run) {
				effects.push({
					type: "openSelectedRunStreams",
					runId: run.id,
					includeChildren: selectedUsesAggregateLogs(state),
				});
			}
		}
	}

	return effects;
}

// ------------------------------------------------------------------- derived

export function rebuildTaskIndexes(state: TuiState): void {
	state.taskTree = buildTaskTree(state.tasks);
	state.taskRows = flattenTaskRows(state.taskTree);
	state.runByTaskKey = indexRunsByTaskKey(state.taskRuns);
	state.displayStatusByTaskKey = buildDisplayStatusByTaskKey(
		state.tasks,
		state.runByTaskKey
	);
	state.selectedIndex = clampSelectedIndex(
		state.taskRows.length,
		state.selectedIndex
	);
}

export function selectedRow(state: TuiState): TaskRow | null {
	return state.taskRows[state.selectedIndex] ?? null;
}

export function selectedTaskKey(state: TuiState): string | null {
	return selectedRow(state)?.key ?? null;
}

export function selectedRun(state: TuiState): TaskRunTreeNode | undefined {
	const row = selectedRow(state);
	if (!row) {
		return undefined;
	}
	return state.runByTaskKey.get(row.key);
}

export function selectedUsesAggregateLogs(state: TuiState): boolean {
	return usesAggregateLogs(
		state.tasks,
		selectedTaskKey(state),
		state.logMode
	);
}

export function stateRunningTaskRows(state: TuiState): RunningTaskRow[] {
	return runningTaskRows(state.taskRows, state.runByTaskKey);
}

// -------------------------------------------------------------- data events

export function applyTasksLoaded(
	state: TuiState,
	tasks: Record<string, Task> | null
): void {
	if (tasks === null) {
		state.errorMessage = "failed to load tasks";
		return;
	}
	state.errorMessage = null;
	state.tasks = tasks;
	rebuildTaskIndexes(state);
}

export function applyRunsLoaded(
	state: TuiState,
	taskRuns: TaskRunTreeNode[] | null
): void {
	if (taskRuns === null) {
		state.errorMessage = "failed to load task runs";
		return;
	}
	state.errorMessage = null;
	state.taskRuns = taskRuns;
	rebuildTaskIndexes(state);
}

export function applyRootRunUpdated(
	state: TuiState,
	run: TaskRunTreeNode
): void {
	state.taskRuns = upsertRunTreeNode(state.taskRuns, run);
	rebuildTaskIndexes(state);
}

export function applyLogSnapshot(
	state: TuiState,
	logs: TaskRunLogLine[]
): void {
	state.logs = logs;
}

export function applyLogLine(state: TuiState, log: TaskRunLogLine): void {
	state.logs = [...state.logs, log];
}

export function applyLogError(state: TuiState, message: string): void {
	state.errorMessage = message;
}

export function setSelectionActive(state: TuiState, active: boolean): void {
	state.hasSelection = active;
}

export function setCopyToast(state: TuiState, message: string | null): void {
	state.copyToastMessage = message;
}

// ---------------------------------------------------------------- key input

export function applyKey(state: TuiState, key: TuiKey): TuiEffect[] {
	if (key.eventType !== undefined && key.eventType !== "press") {
		return [];
	}

	if (state.showQuitConfirmation) {
		return handleQuitConfirmationKeys(state, key);
	}

	const copyEffects = handleCopySelectionKey(state, key);
	if (copyEffects) {
		return copyEffects;
	}
	if (isQuitKey(key)) {
		return requestQuit(state);
	}
	if (handleTaskSearchShortcut(state, key)) {
		return [];
	}
	if (state.isTaskSearchFocused) {
		return handleTaskSearchInputKeys(state, key);
	}
	if (handlePaneNavigation(state, key)) {
		return [];
	}
	if (state.taskRows.length === 0) {
		return [];
	}
	if (handleTaskNavigation(state, key)) {
		return [];
	}
	return handleActionKeys(state, key);
}

function isQuitKey(key: TuiKey): boolean {
	return key.name === "q" || (Boolean(key.ctrl) && key.name === "c");
}

/**
 * `ctrl` covers Ctrl+C everywhere. `super`/`meta` covers Cmd+C in the terminals
 * that forward it (Kitty, Ghostty, WezTerm with the kitty keyboard protocol).
 * With nothing selected the key falls through to the quit handler.
 */
function handleCopySelectionKey(
	state: TuiState,
	key: TuiKey
): TuiEffect[] | null {
	if (key.name !== "c") {
		return null;
	}
	if (!(key.ctrl || key.meta || key.super)) {
		return null;
	}
	if (!state.hasSelection) {
		return null;
	}
	state.hasSelection = false;
	return [{ type: "copySelection" }];
}

function requestQuit(state: TuiState): TuiEffect[] {
	if (stateRunningTaskRows(state).length > 0) {
		state.showQuitConfirmation = true;
		state.quitActionIndex = 0;
		return [];
	}
	state.shouldQuit = true;
	return [{ type: "quit" }];
}

function handleQuitConfirmationKeys(state: TuiState, key: TuiKey): TuiEffect[] {
	if (state.isCancellingBeforeExit) {
		return [];
	}
	if (
		key.name === "y" ||
		key.name === "q" ||
		(key.ctrl && key.name === "c")
	) {
		return confirmQuit(state, "cancelAll");
	}
	if (key.name === "n") {
		return confirmQuit(state, "exitWithoutCancelling");
	}
	if (key.name === "left" || key.name === "[") {
		state.quitActionIndex =
			state.quitActionIndex === 0
				? QUIT_ACTIONS.length - 1
				: state.quitActionIndex - 1;
		return [];
	}
	if (key.name === "right" || key.name === "]") {
		state.quitActionIndex =
			(state.quitActionIndex + 1) % QUIT_ACTIONS.length;
		return [];
	}
	if (key.name === "enter" || key.name === "return") {
		const action = QUIT_ACTIONS[state.quitActionIndex];
		if (action) {
			return confirmQuit(state, action.action);
		}
	}
	return [];
}

function confirmQuit(
	state: TuiState,
	action: QuitConfirmationAction
): TuiEffect[] {
	if (action === "exitWithoutCancelling") {
		state.shouldQuit = true;
		return [{ type: "quit" }];
	}
	if (state.isCancellingBeforeExit) {
		return [];
	}
	state.isCancellingBeforeExit = true;
	const runIds = stateRunningTaskRows(state).flatMap((row) => {
		const run = state.runByTaskKey.get(row.key);
		return run ? [run.id] : [];
	});
	return [{ type: "cancelRunsBeforeExit", runIds }];
}

function handleTaskSearchShortcut(state: TuiState, key: TuiKey): boolean {
	if (key.name !== "/" || state.isTaskSearchFocused) {
		return false;
	}
	focusTaskSearch(state);
	return true;
}

function focusTaskSearch(state: TuiState): void {
	state.focusedPane = "tasks";
	state.isTaskSearchFocused = true;
}

function clearTaskSearch(state: TuiState): void {
	state.taskSearchQuery = "";
	state.showTaskSearchError = false;
	state.isTaskSearchFocused = false;
}

/**
 * A single printable character for `key`, or null for control keys. Kept
 * separate so the search box treats Ctrl-chords as control keys rather than
 * text.
 */
export function printableCharacter(key: TuiKey): string | null {
	if (key.ctrl || key.meta || key.super) {
		return null;
	}
	const candidate =
		key.sequence && [...key.sequence].length === 1
			? key.sequence
			: key.name;
	if (!candidate || [...candidate].length !== 1) {
		return null;
	}
	const codePoint = candidate.codePointAt(0) ?? 0;
	if (codePoint < 0x20 || codePoint === 0x7f) {
		return null;
	}
	return candidate;
}

function handleTaskSearchInputKeys(state: TuiState, key: TuiKey): TuiEffect[] {
	// Down (and the vim-style `j`) leaves the search box for the task list.
	if (key.name === "down" || key.name === "j") {
		if (state.taskRows.length > 0) {
			state.selectedIndex = 0;
			state.isTaskSearchFocused = false;
			state.focusedPane = "tasks";
		}
		return [];
	}
	if (key.name === "/") {
		return [];
	}
	if (key.name === "escape") {
		clearTaskSearch(state);
		return [];
	}
	if (key.name === "enter" || key.name === "return") {
		return handleTaskSearchSubmit(state);
	}
	if (key.name === "backspace") {
		state.taskSearchQuery = [...state.taskSearchQuery]
			.slice(0, -1)
			.join("");
		state.showTaskSearchError = false;
		return [];
	}
	const character = printableCharacter(key);
	if (character !== null) {
		state.taskSearchQuery += character;
		state.showTaskSearchError = false;
	}
	return [];
}

function handleTaskSearchSubmit(state: TuiState): TuiEffect[] {
	const exactQuery = state.taskSearchQuery.trim();
	if (!exactQuery) {
		state.showTaskSearchError = false;
		return [];
	}
	const rowIndex = state.taskRows.findIndex((row) => row.key === exactQuery);
	if (rowIndex < 0) {
		state.showTaskSearchError = true;
		return [];
	}
	state.showTaskSearchError = false;
	return runExactTaskSearchMatch(state, rowIndex);
}

function runExactTaskSearchMatch(
	state: TuiState,
	rowIndex: number
): TuiEffect[] {
	const row = state.taskRows[rowIndex];
	if (!row) {
		return [];
	}
	state.selectedIndex = rowIndex;

	const action = resolveRowAction(state, row.key, row.depth);
	if (action === "run") {
		clearTaskSearch(state);
		return [{ type: "runTask", taskKey: row.key }];
	}

	const run = state.runByTaskKey.get(row.key);
	if (run) {
		clearTaskSearch(state);
		state.logs = [];
		return [{ type: "restartRun", runId: run.id }];
	}

	state.errorMessage =
		row.depth > 0
			? "Cannot restart subtask without an existing parent-linked run."
			: "Cannot restart task because no existing run was found.";
	return [];
}

function handlePaneNavigation(state: TuiState, key: TuiKey): boolean {
	const isRight = key.name === "right" || key.name === "l";
	const isLeft = key.name === "left" || key.name === "h";
	if (isRight && state.focusedPane !== "logs") {
		state.focusedPane = "logs";
		return true;
	}
	if (isLeft && state.focusedPane === "logs") {
		state.focusedPane = "tasks";
		return true;
	}
	return false;
}

function handleTaskNavigation(state: TuiState, key: TuiKey): boolean {
	if (state.focusedPane === "logs") {
		// The log pane owns vertical movement; it never moves the selection.
		return [
			"up",
			"k",
			"down",
			"j",
			"pageup",
			"pagedown",
			"home",
			"end",
		].includes(key.name);
	}

	if (isJumpParentsBackwardShortcut(key, state.isMacOs)) {
		state.selectedIndex = findPreviousParentTaskIndex(
			state.taskRows,
			state.selectedIndex
		);
		return true;
	}
	if (key.name === "up" || key.name === "k") {
		if (state.selectedIndex === 0) {
			focusTaskSearch(state);
			// The keypress that focuses the search box is also typed into it,
			// so `k` opens search with "k" already in the query while Up does
			// not.
			const character = printableCharacter(key);
			if (character !== null) {
				state.taskSearchQuery += character;
				state.showTaskSearchError = false;
			}
			return true;
		}
		state.selectedIndex = Math.max(0, state.selectedIndex - 1);
		return true;
	}
	if (isJumpParentsForwardShortcut(key, state.isMacOs)) {
		state.selectedIndex = findNextParentTaskIndex(
			state.taskRows,
			state.selectedIndex
		);
		return true;
	}
	if (key.name === "down" || key.name === "j") {
		state.selectedIndex = Math.min(
			state.taskRows.length - 1,
			state.selectedIndex + 1
		);
		return true;
	}
	return false;
}

function handleActionKeys(state: TuiState, key: TuiKey): TuiEffect[] {
	if (key.name === "m") {
		if (canToggleLogMode(state.tasks, selectedTaskKey(state))) {
			state.logMode =
				state.logMode === "aggregate" ? "selected" : "aggregate";
		}
		return [];
	}
	if (key.name === "r") {
		const row = selectedRow(state);
		if (!row) {
			return [];
		}
		if (resolveRowAction(state, row.key, row.depth) === "restart") {
			const run = state.runByTaskKey.get(row.key);
			if (!run) {
				return [];
			}
			state.logs = [];
			return [{ type: "restartRun", runId: run.id }];
		}
		return [{ type: "runTask", taskKey: row.key }];
	}
	if (key.name === "c") {
		const run = selectedRun(state);
		if (!(run && canCancelRun(run))) {
			return [];
		}
		return [{ type: "cancelRun", runId: run.id }];
	}
	return [];
}
