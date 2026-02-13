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
	const mostRecentSegment = line.split("\r").at(-1) ?? line;
	return (
		mostRecentSegment
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes for terminal output
			.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI OSC sequences
			.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars to strip from logs
			.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
	);
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
