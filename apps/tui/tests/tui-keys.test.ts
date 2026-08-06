import { describe, expect, it } from "bun:test";
import {
	applyKey,
	applyRunsLoaded,
	applyTasksLoaded,
	createTuiState,
	type TuiEffect,
	type TuiKey,
	type TuiState,
} from "../src/lib/tui-state";
import { caseName, loadSpec, logLine, runTree, taskMap } from "./spec";

interface KeyCase {
	name?: string;
	tasks?: string;
	runs?: string;
	isMacOs?: boolean;
	initial?: Partial<
		Pick<
			TuiState,
			| "selectedIndex"
			| "focusedPane"
			| "isTaskSearchFocused"
			| "taskSearchQuery"
			| "logMode"
			| "hasSelection"
			| "showQuitConfirmation"
			| "isCancellingBeforeExit"
			| "quitActionIndex"
		>
	>;
	keys: TuiKey[];
	expect: Record<string, unknown>;
}

const spec = loadSpec<{ cases: KeyCase[] }>("tui-keys.json");

const SEEDED_LOG_COUNT = 2;

/**
 * `quit` and `copySelection` are asserted through `shouldQuit` and the absence
 * of other effects, so the shared spec only lists the server-facing ones.
 */
function serverEffects(effects: TuiEffect[]): TuiEffect[] {
	return effects.filter(
		(effect) => effect.type !== "quit" && effect.type !== "copySelection"
	);
}

function buildState(testCase: KeyCase): TuiState {
	const state = createTuiState({ isMacOs: testCase.isMacOs ?? false });
	applyTasksLoaded(state, taskMap(testCase.tasks ?? "monorepo"));
	applyRunsLoaded(state, runTree(testCase.runs ?? "none"));
	state.logs = Array.from({ length: SEEDED_LOG_COUNT }, (_unused, index) =>
		logLine({ sequence: index, line: `seeded ${index}` })
	);
	Object.assign(state, testCase.initial ?? {});
	return state;
}

describe("TUI key handling", () => {
	spec.cases.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const state = buildState(testCase);
			const effects: TuiEffect[] = [];
			for (const key of testCase.keys) {
				effects.push(...applyKey(state, key));
			}

			const actual: Record<string, unknown> = {
				selectedIndex: state.selectedIndex,
				focusedPane: state.focusedPane,
				isTaskSearchFocused: state.isTaskSearchFocused,
				taskSearchQuery: state.taskSearchQuery,
				showTaskSearchError: state.showTaskSearchError,
				showQuitConfirmation: state.showQuitConfirmation,
				quitActionIndex: state.quitActionIndex,
				isCancellingBeforeExit: state.isCancellingBeforeExit,
				errorMessage: state.errorMessage,
				shouldQuit: state.shouldQuit,
				logMode: state.logMode,
				logCount: state.logs.length,
				effects: serverEffects(effects),
			};

			for (const [field, expected] of Object.entries(testCase.expect)) {
				expect({ [field]: actual[field] }).toEqual({
					[field]: expected,
				});
			}
		});
	});
});

describe("TUI state bookkeeping", () => {
	it("clamps the selection when the task list shrinks", () => {
		const state = createTuiState();
		applyTasksLoaded(state, taskMap("monorepo"));
		state.selectedIndex = 6;
		applyTasksLoaded(state, taskMap("flat"));
		expect(state.selectedIndex).toBe(1);
	});

	it("resets the selection when every task disappears", () => {
		const state = createTuiState();
		applyTasksLoaded(state, taskMap("monorepo"));
		state.selectedIndex = 4;
		applyTasksLoaded(state, taskMap("empty"));
		expect(state.selectedIndex).toBe(0);
		expect(state.taskRows).toEqual([]);
	});

	it("surfaces a load failure and keeps the last good data", () => {
		const state = createTuiState();
		applyTasksLoaded(state, taskMap("monorepo"));
		applyTasksLoaded(state, null);
		expect(state.errorMessage).toBe("failed to load tasks");
		expect(state.taskRows).toHaveLength(7);

		applyRunsLoaded(state, null);
		expect(state.errorMessage).toBe("failed to load task runs");
	});

	it("clears the error once a load succeeds again", () => {
		const state = createTuiState();
		applyRunsLoaded(state, null);
		applyRunsLoaded(state, runTree("devRunning"));
		expect(state.errorMessage).toBeNull();
		expect(state.runByTaskKey.get("dev:api")?.id).toBe("run-dev-api");
	});
});
