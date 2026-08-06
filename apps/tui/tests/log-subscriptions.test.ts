import { describe, expect, it } from "bun:test";
import type { TaskRunTreeNode } from "@getbizi/client";
import {
	applyKey,
	applyRootRunUpdated,
	applyRunsLoaded,
	applyTasksLoaded,
	createTuiState,
	syncSubscriptions,
	type TuiEffect,
	type TuiKey,
	type TuiState,
} from "../src/lib/tui-state";
import { caseName, loadSpec, logLine, runTree, taskMap } from "./spec";

interface Step {
	sync?: boolean;
	clearEffects?: boolean;
	runsLoaded?: string;
	runUpdated?: TaskRunTreeNode;
	selectedIndex?: number;
	key?: TuiKey;
}

interface SubscriptionCase {
	name?: string;
	tasks?: string;
	runs?: string;
	initial?: Partial<TuiState>;
	steps: Step[];
	expect: Record<string, unknown>;
}

const spec = loadSpec<{ cases: SubscriptionCase[] }>("log-subscriptions.json");

const SEEDED_LOG_COUNT = 2;

describe("log stream subscriptions", () => {
	spec.cases.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const state = createTuiState();
			applyTasksLoaded(state, taskMap(testCase.tasks ?? "monorepo"));
			applyRunsLoaded(state, runTree(testCase.runs ?? "none"));
			state.logs = Array.from(
				{ length: SEEDED_LOG_COUNT },
				(_unused, logIndex) => logLine({ sequence: logIndex })
			);
			Object.assign(state, testCase.initial ?? {});

			let effects: TuiEffect[] = [];
			for (const step of testCase.steps) {
				if (step.clearEffects) {
					effects = [];
					continue;
				}
				if (step.runsLoaded !== undefined) {
					applyRunsLoaded(state, runTree(step.runsLoaded));
				}
				if (step.runUpdated !== undefined) {
					applyRootRunUpdated(state, step.runUpdated);
				}
				if (step.selectedIndex !== undefined) {
					state.selectedIndex = step.selectedIndex;
				}
				if (step.key !== undefined) {
					effects.push(...applyKey(state, step.key));
				}
				effects.push(...syncSubscriptions(state));
			}

			const actual: Record<string, unknown> = {
				effects,
				logCount: state.logs.length,
				selectedStreamKey: state.selectedStreamKey,
				rootStreamKey: state.rootStreamKey,
			};

			for (const [field, expected] of Object.entries(testCase.expect)) {
				expect({ [field]: actual[field] }).toEqual({
					[field]: expected,
				});
			}
		});
	});
});

describe("stream keys", () => {
	it("re-keys on every part of the run's revision", () => {
		const state = createTuiState();
		applyTasksLoaded(state, taskMap("monorepo"));
		applyRunsLoaded(state, runTree("devRunning"));
		syncSubscriptions(state);
		const initial = state.selectedStreamKey;

		applyRootRunUpdated(state, {
			id: "run-dev",
			task: "dev",
			cwd: "/repo",
			status: "Running",
			updatedAt: 1001,
			children: [],
		});
		syncSubscriptions(state);
		expect(state.selectedStreamKey).not.toBe(initial);
		expect(state.selectedStreamKey).toContain("run-dev");
	});
});
