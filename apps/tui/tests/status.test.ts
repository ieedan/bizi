import { describe, expect, it } from "bun:test";
import { resolveTaskLogColor } from "../src/lib/logs";
import { taskStatusDisplay } from "../src/lib/status";
import type { DisplayTaskStatus } from "../src/types";
import { loadSpec } from "./spec";

interface Spec {
	taskStatusDisplay: {
		status: string | null;
		icon: string;
		color: string;
	}[];
	resolveTaskLogColor: {
		input: string | null;
		expected: string | null;
	}[];
}

const spec = loadSpec<Spec>("status.json");

describe("taskStatusDisplay", () => {
	for (const testCase of spec.taskStatusDisplay) {
		it(`${testCase.status ?? "no status"} renders ${testCase.icon}`, () => {
			const display = taskStatusDisplay(
				(testCase.status ?? undefined) as DisplayTaskStatus
			);
			expect(display.icon).toBe(testCase.icon);
			expect(display.color).toBe(testCase.color);
		});
	}
});

describe("resolveTaskLogColor", () => {
	for (const testCase of spec.resolveTaskLogColor) {
		it(`${JSON.stringify(testCase.input)} -> ${testCase.expected}`, () => {
			expect(resolveTaskLogColor(testCase.input) ?? null).toBe(
				testCase.expected
			);
		});
	}

	it("treats an absent color the same as a blank one", () => {
		expect(resolveTaskLogColor(undefined)).toBeUndefined();
	});
});
