import { describe, expect, it } from "bun:test";
import {
	isJumpParentsBackwardShortcut,
	isJumpParentsForwardShortcut,
} from "../src/lib/keyboard-shortcuts";
import { caseName, loadSpec } from "./spec";

interface Spec {
	cases: {
		name?: string;
		key: { name: string; ctrl?: boolean; option?: boolean };
		isMacOs: boolean;
		forward: boolean;
		backward: boolean;
	}[];
}

const spec = loadSpec<Spec>("keyboard.json");

describe("jump-to-parent shortcuts", () => {
	spec.cases.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			expect(
				isJumpParentsForwardShortcut(testCase.key, testCase.isMacOs)
			).toBe(testCase.forward);
			expect(
				isJumpParentsBackwardShortcut(testCase.key, testCase.isMacOs)
			).toBe(testCase.backward);
		});
	});
});
