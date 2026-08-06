import { describe, expect, it } from "bun:test";
import {
	findFirstPositionalTokenIndex,
	normalizeImplicitRunCommand,
} from "../src/commands/cli";
import { parseCliOptions } from "../src/lib/args";
import {
	DEFAULT_BIZI_API_HOST,
	DEFAULT_BIZI_API_PORT,
	resolveApiHost,
	resolveApiPort,
} from "../src/lib/bizi-api";
import { caseName, loadSpec } from "./spec";

interface Spec {
	findFirstPositionalTokenIndex: {
		name?: string;
		argv: string[];
		expected: number | null;
	}[];
	normalizeImplicitRunCommand: {
		name?: string;
		argv: string[];
		expectedArgv: string[];
		expectedImplicit: boolean;
	}[];
}

const spec = loadSpec<Spec>("cli-args.json");

describe("findFirstPositionalTokenIndex", () => {
	spec.findFirstPositionalTokenIndex.forEach((testCase, index) => {
		it(caseName(testCase, index) + ` [${testCase.argv.join(" ")}]`, () => {
			const actual = findFirstPositionalTokenIndex(testCase.argv);
			expect(actual === -1 ? null : actual).toBe(testCase.expected);
		});
	});
});

describe("normalizeImplicitRunCommand", () => {
	spec.normalizeImplicitRunCommand.forEach((testCase, index) => {
		it(caseName(testCase, index), () => {
			const result = normalizeImplicitRunCommand(testCase.argv);
			expect(result.argv).toEqual(testCase.expectedArgv);
			expect(result.wasImplicitRun).toBe(testCase.expectedImplicit);
		});
	});
});

describe("parseCliOptions", () => {
	it("defaults to the process working directory", () => {
		expect(parseCliOptions([]).cwd).toBe(process.cwd());
	});

	it("accepts the long and short cwd flags", () => {
		expect(parseCliOptions(["--cwd", "/tmp/a"]).cwd).toBe("/tmp/a");
		expect(parseCliOptions(["-C", "/tmp/b"]).cwd).toBe("/tmp/b");
		expect(parseCliOptions(["--cwd=/tmp/c"]).cwd).toBe("/tmp/c");
	});

	// Unknown options exit the process rather than throwing, so that path is
	// covered by the end-to-end suite instead.
});

describe("server target resolution", () => {
	it("falls back to the default port", () => {
		for (const value of [
			undefined,
			"",
			"   ",
			"nope",
			"0",
			"70000",
			"-1",
		]) {
			expect(resolveApiPort(value)).toBe(DEFAULT_BIZI_API_PORT);
		}
	});

	it("uses BIZI_PORT when it is a valid port", () => {
		expect(resolveApiPort("8080")).toBe(8080);
		expect(resolveApiPort(" 65535 ")).toBe(65_535);
	});

	it("falls back to the default host", () => {
		for (const value of [undefined, "", "   "]) {
			expect(resolveApiHost(value)).toBe(DEFAULT_BIZI_API_HOST);
		}
	});

	it("uses BIZI_HOST when it is set", () => {
		expect(resolveApiHost("127.0.0.1")).toBe("127.0.0.1");
	});
});
