export function formatTaskTagForLog(taskName: string, width: number): string {
    const minWidth = 4;
    const safeWidth = Math.max(minWidth, width);
    const suffix = "] ";
    const prefix = "[";
    const innerWidth = Math.max(1, safeWidth - prefix.length - suffix.length);
    const displayTaskName =
        taskName.length > innerWidth ? `${taskName.slice(0, Math.max(1, innerWidth - 1))}…` : taskName;
    return `${prefix}${displayTaskName}${suffix}`.padEnd(safeWidth, " ");
}

const BASIC_TERMINAL_COLORS = new Set(["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]);
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function resolveTaskLogColor(color: string | null | undefined): string | undefined {
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
    return mostRecentSegment
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}
