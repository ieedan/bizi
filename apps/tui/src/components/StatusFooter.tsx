import { For } from "solid-js";
import { useAppContext } from "../lib/app-context";

type StatusFooterProps = {
    errorMessage: string | null;
    canNavigateTasks: boolean;
    canJumpParentTasks: boolean;
    canRunOrRestart: boolean;
    runAction: "run" | "restart";
    canCancel: boolean;
    canToggleLogMode: boolean;
};

export function StatusFooter(props: StatusFooterProps) {
    const actions = () => {
        const parts: Array<{ key: string; label: string }> = [];
        if (props.canRunOrRestart) {
            parts.push({ key: "r", label: props.runAction });
        }
        if (props.canCancel) {
            parts.push({ key: "c", label: "cancel" });
        }
        if (props.canToggleLogMode) {
            parts.push({ key: "l", label: "log mode" });
        }
        parts.push({ key: "q", label: "quit" });
        return parts;
    };

    return (
        <box border={["left", "right", "bottom"]} borderColor="#666666" paddingLeft={1}>
            <text>
                <For each={actions()}>
                    {(action, idx) => (
                        <>
                            {idx() > 0 ? <span style={{ fg: "#666666" }}> | </span> : ""}
                            {action.key} <span style={{ fg: "#666666" }}>{action.label}</span>
                        </>
                    )}
                </For>
                {props.errorMessage ? ` | error: ${props.errorMessage}` : ""}
            </text>
        </box>
    );
}
