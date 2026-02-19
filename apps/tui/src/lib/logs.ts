export function formatTaskTagForLog(taskName: string, width: number): string {
	const minWidth = 4;
	const safeWidth = Math.max(minWidth, width);
	const suffix = "] ";
	const prefix = "[";
	const innerWidth = Math.max(1, safeWidth - prefix.length - suffix.length);
	const displayTaskName =
		taskName.length > innerWidth
			? `${taskName.slice(0, Math.max(1, innerWidth - 1))}…`
			: taskName;
	return `${prefix}${displayTaskName}${suffix}`.padEnd(safeWidth, " ");
}

const BASIC_TERMINAL_COLORS = new Set([
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
]);
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI OSC sequence stripping
const OSC_SEQUENCE_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI DCS/PM/APC sequence stripping
const ANSI_STRING_SEQUENCE_PATTERN = /\x1b(?:P|X|\^|_)[\s\S]*?\x1b\\/g;

const ANSI_16_COLOR_HEX = [
	"#000000",
	"#aa0000",
	"#00aa00",
	"#aa5500",
	"#0000aa",
	"#aa00aa",
	"#00aaaa",
	"#aaaaaa",
	"#555555",
	"#ff5555",
	"#55ff55",
	"#ffff55",
	"#5555ff",
	"#ff55ff",
	"#55ffff",
	"#ffffff",
];

export interface LogTextStyle {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
}

export interface ParsedLogSegment {
	text: string;
	style: LogTextStyle;
}

export function resolveTaskLogColor(
	color: string | null | undefined
): string | undefined {
	const trimmedColor = color?.trim();
	if (!trimmedColor) {
		return undefined;
	}

	const normalizedName = trimmedColor.toLowerCase();
	if (BASIC_TERMINAL_COLORS.has(normalizedName)) {
		return normalizedName;
	}

	if (HEX_COLOR_PATTERN.test(trimmedColor)) {
		return trimmedColor.toLowerCase();
	}

	return undefined;
}

export function sanitizeLogForDisplay(line: string): string {
	return parseAnsiLogSegments(line)
		.map((segment) => segment.text)
		.join("");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ANSI parsing requires stateful scanning
export function parseAnsiLogSegments(line: string): ParsedLogSegment[] {
	const sanitizedLine = stripUnsupportedTerminalSequences(
		line.split("\r").at(-1) ?? line
	);
	const segments: ParsedLogSegment[] = [];
	const currentStyle: LogTextStyle = {};
	let currentText = "";
	let index = 0;

	const flushSegment = () => {
		if (currentText.length === 0) {
			return;
		}

		segments.push({
			text: currentText,
			style: { ...currentStyle },
		});
		currentText = "";
	};

	while (index < sanitizedLine.length) {
		const charCode = sanitizedLine.charCodeAt(index);
		if (charCode === 0x1b) {
			const next = sanitizedLine[index + 1];
			if (next === "[") {
				let cursor = index + 2;
				while (cursor < sanitizedLine.length) {
					const csiByte = sanitizedLine.charCodeAt(cursor);
					if (csiByte >= 0x40 && csiByte <= 0x7e) {
						break;
					}
					cursor += 1;
				}

				if (cursor < sanitizedLine.length) {
					if (sanitizedLine[cursor] === "m") {
						flushSegment();
						applySgrSequence(
							sanitizedLine.slice(index + 2, cursor),
							currentStyle
						);
					}
					index = cursor + 1;
					continue;
				}
			}

			index += next ? 2 : 1;
			continue;
		}

		if ((charCode < 0x20 || charCode === 0x7f) && charCode !== 0x09) {
			index += 1;
			continue;
		}

		currentText += sanitizedLine[index] ?? "";
		index += 1;
	}

	flushSegment();
	return segments.length > 0 ? segments : [{ text: "", style: {} }];
}

export function formatLogTimestamp(timestampMs: number): string {
	const date = new Date(timestampMs);
	if (Number.isNaN(date.getTime())) {
		return "--:--:--.---";
	}

	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	const millis = String(date.getMilliseconds()).padStart(3, "0");
	return `${hours}:${minutes}:${seconds}.${millis}`;
}

export function formatElapsedDuration(durationMs: number): string {
	const safeDuration = Math.max(0, durationMs);
	if (safeDuration < 1000) {
		return `${Math.round(safeDuration)}ms`;
	}
	if (safeDuration < 60_000) {
		return `${Math.floor(safeDuration / 1000)}s`;
	}
	if (safeDuration < 3_600_000) {
		const minutes = Math.floor(safeDuration / 60_000);
		const seconds = Math.floor((safeDuration % 60_000) / 1000);
		return `${minutes}m ${seconds}s`;
	}
	const hours = Math.floor(safeDuration / 3_600_000);
	const minutes = Math.floor((safeDuration % 3_600_000) / 60_000);
	return `${hours}h ${minutes}m`;
}

function stripUnsupportedTerminalSequences(line: string): string {
	const withoutOsc = line.replace(OSC_SEQUENCE_PATTERN, "");
	const withoutStringSequences = withoutOsc.replace(
		ANSI_STRING_SEQUENCE_PATTERN,
		""
	);
	return withoutStringSequences;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SGR decoding handles many escape variants
function applySgrSequence(sequence: string, style: LogTextStyle): void {
	const rawValues = sequence.length > 0 ? sequence.split(";") : ["0"];
	for (let index = 0; index < rawValues.length; index += 1) {
		const code = Number.parseInt(rawValues[index] ?? "", 10);
		if (!Number.isFinite(code)) {
			continue;
		}

		if (code === 38 || code === 48) {
			const channel: "fg" | "bg" = code === 38 ? "fg" : "bg";
			const mode = Number.parseInt(rawValues[index + 1] ?? "", 10);
			if (mode === 5) {
				const colorIndex = Number.parseInt(rawValues[index + 2] ?? "", 10);
				const color = toAnsi256Color(colorIndex);
				if (color) {
					style[channel] = color;
				}
				index += 2;
				continue;
			}

			if (mode === 2) {
				const red = Number.parseInt(rawValues[index + 2] ?? "", 10);
				const green = Number.parseInt(rawValues[index + 3] ?? "", 10);
				const blue = Number.parseInt(rawValues[index + 4] ?? "", 10);
				if (
					isValidRgbChannel(red) &&
					isValidRgbChannel(green) &&
					isValidRgbChannel(blue)
				) {
					style[channel] = rgbToHex(red, green, blue);
				}
				index += 4;
				continue;
			}
		}

		switch (code) {
			case 0:
				style.fg = undefined;
				style.bg = undefined;
				style.bold = undefined;
				style.dim = undefined;
				style.italic = undefined;
				style.underline = undefined;
				break;
			case 1:
				style.bold = true;
				style.dim = false;
				break;
			case 2:
				style.dim = true;
				style.bold = false;
				break;
			case 3:
				style.italic = true;
				break;
			case 4:
				style.underline = true;
				break;
			case 22:
				style.bold = undefined;
				style.dim = undefined;
				break;
			case 23:
				style.italic = undefined;
				break;
			case 24:
				style.underline = undefined;
				break;
			case 39:
				style.fg = undefined;
				break;
			case 49:
				style.bg = undefined;
				break;
			default:
				if (code >= 30 && code <= 37) {
					style.fg = ANSI_16_COLOR_HEX[code - 30];
					break;
				}
				if (code >= 90 && code <= 97) {
					style.fg = ANSI_16_COLOR_HEX[8 + (code - 90)];
					break;
				}
				if (code >= 40 && code <= 47) {
					style.bg = ANSI_16_COLOR_HEX[code - 40];
					break;
				}
				if (code >= 100 && code <= 107) {
					style.bg = ANSI_16_COLOR_HEX[8 + (code - 100)];
				}
				break;
		}
	}
}

function toAnsi256Color(index: number): string | undefined {
	if (!Number.isInteger(index) || index < 0 || index > 255) {
		return undefined;
	}
	if (index < 16) {
		return ANSI_16_COLOR_HEX[index];
	}
	if (index <= 231) {
		const shifted = index - 16;
		const redLevel = Math.floor(shifted / 36);
		const greenLevel = Math.floor((shifted % 36) / 6);
		const blueLevel = shifted % 6;
		const scale = [0, 95, 135, 175, 215, 255];
		return rgbToHex(scale[redLevel], scale[greenLevel], scale[blueLevel]);
	}
	const gray = 8 + (index - 232) * 10;
	return rgbToHex(gray, gray, gray);
}

function rgbToHex(red: number, green: number, blue: number): string {
	const toHex = (value: number) => value.toString(16).padStart(2, "0");
	return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function isValidRgbChannel(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && value <= 255;
}
