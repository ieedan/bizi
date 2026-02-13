import type { DisplayTaskStatus } from "../types";

type TaskStatusDisplay = {
    color: string;
    icon: string;
};

export function taskStatusDisplay(status: DisplayTaskStatus): TaskStatusDisplay {
    if (!status) {
        return { color: "#777777", icon: "○" };
    }
    if (status === "Indeterminate") {
        return { color: "#f4c542", icon: "◐" };
    }
    if (status === "Queued") {
        return { color: "#f4c542", icon: "○" };
    }
    if (status === "Running") {
        return { color: "#31d158", icon: "▶" };
    }
    if (status === "Success") {
        return { color: "#4da3ff", icon: "✓" };
    }
    if (status === "Failed") {
        return { color: "#ff3b30", icon: "✖" };
    }
    if (status === "Cancelled") {
        return { color: "#777777", icon: "■" };
    }
    return { color: "#777777", icon: "○" };
}
