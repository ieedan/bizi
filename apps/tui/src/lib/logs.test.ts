import { describe, expect, it } from "bun:test";
import { parseAnsiLogSegments, sanitizeLogForDisplay } from "./logs";

describe("parseAnsiLogSegments", () => {
	it("parses basic SGR color sequences into styled segments", () => {
		const segments = parseAnsiLogSegments(
			"prefix \u001b[31mred\u001b[0m suffix"
		);
		expect(segments).toEqual([
			{ text: "prefix ", style: {} },
			{ text: "red", style: { fg: "#aa0000" } },
			{ text: " suffix", style: {} },
		]);
	});

	it("strips OSC sequences and unsafe control bytes", () => {
		const segments = parseAnsiLogSegments(
			"safe\u001b]0;title\u0007\u0007\u0001\u0002text"
		);
		expect(segments).toEqual([{ text: "safetext", style: {} }]);
	});

	it("ignores malformed escape prefixes and keeps plain text", () => {
		const segments = parseAnsiLogSegments("hello \u001b[31");
		expect(segments).toEqual([{ text: "hello 31", style: {} }]);
	});
});

describe("sanitizeLogForDisplay", () => {
	it("returns plain text view for ansi-colored lines", () => {
		expect(sanitizeLogForDisplay("a \u001b[32mok\u001b[0m b")).toBe("a ok b");
	});
});
