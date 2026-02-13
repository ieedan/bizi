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

export function sanitizeLogForDisplay(line: string): string {
    const mostRecentSegment = line.split("\r").at(-1) ?? line;
    return mostRecentSegment
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}
