import { describe, expect, it } from "bun:test";
import {
	formatElapsedDuration,
	formatLogTimestamp,
	formatTaskTagForLog,
	type LogTextStyle,
	parseAnsiLogSegments,
	sanitizeLogForDisplay,
} from "../src/lib/logs";
import { caseName, loadSpec } from "./spec";

interface Spec {
	formatTaskTagForLog: {
		name?: string;
		task: string;
		width: number;
		expected: string;
	}[];
	formatElapsedDuration: { name?: string; input: number; expected: string }[];
	formatLogTimestamp: { name?: string; input: number; expected: string }[];
	sanitizeLogForDisplay: {
		name?: string;
		input: string;
		expected: string;
	}[];
	parseAnsiLogSegments: {
		name?: string;
		input: string;
		expected: { text: string; style: LogTextStyle }[];
	}[];
}

const spec = loadSpec<Spec>("logs.json");

/**
 * The spec only lists the style keys a segment should carry; anything the
 * parser leaves `undefined` is dropped so the two clients can be compared
 * without arguing about absent-versus-undefined.
 */
function definedStyleKeys(style: LogTextStyle): LogTextStyle {
	return Object.fromEntries(
		Object.entries(style).filter(([, value]) => value !== undefined)
	) as LogTextStyle;
}

describe("formatTaskTagForLog", () => {
	spec.formatTaskTagForLog.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(formatTaskTagForLog(testCase.task, testCase.width)).toBe(
				testCase.expected
			);
		});
	});
});

describe("formatElapsedDuration", () => {
	for (const testCase of spec.formatElapsedDuration) {
		it(`${testCase.input}ms -> ${testCase.expected}`, () => {
			expect(formatElapsedDuration(testCase.input)).toBe(
				testCase.expected
			);
		});
	}
});

describe("formatLogTimestamp", () => {
	for (const testCase of spec.formatLogTimestamp) {
		it(`${testCase.input} -> ${testCase.expected}`, () => {
			expect(formatLogTimestamp(testCase.input)).toBe(testCase.expected);
		});
	}

	it("falls back for an unrepresentable timestamp", () => {
		expect(formatLogTimestamp(Number.NaN)).toBe("--:--:--.---");
	});
});

describe("sanitizeLogForDisplay", () => {
	spec.sanitizeLogForDisplay.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(sanitizeLogForDisplay(testCase.input)).toBe(
				testCase.expected
			);
		});
	});
});

describe("tab handling", () => {
	// Not in the shared spec: this client keeps tabs and lets the terminal lay
	// them out, while the Rust client expands them to 8-column tab stops
	// because ratatui cannot render a tab. See tests/README.md.
	it("keeps tab characters intact", () => {
		expect(sanitizeLogForDisplay("keep\tthe\ttabs")).toBe(
			"keep\tthe\ttabs"
		);
		expect(parseAnsiLogSegments("a\tb")).toEqual([
			{ text: "a\tb", style: {} },
		]);
	});
});

describe("parseAnsiLogSegments", () => {
	spec.parseAnsiLogSegments.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const actual = parseAnsiLogSegments(testCase.input).map(
				(segment) => ({
					text: segment.text,
					style: definedStyleKeys(segment.style),
				})
			);
			expect(actual).toEqual(testCase.expected);
		});
	});
});
