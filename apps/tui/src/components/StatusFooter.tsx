import { useAppContext } from "../lib/app-context";

type StatusFooterProps = {
    errorMessage: string | null;
};

export function StatusFooter(props: StatusFooterProps) {
    const { isMacOs } = useAppContext();

    return (
        <box border={["left", "right", "bottom"]} borderColor="#666666" paddingLeft={1}>
            <text>
                arrows/jk move | jump parents:{" "}
                {isMacOs ? "option+up/down or option+k/j" : "ctrl+up/down or ctrl+k/j"} | r
                run/restart (auto) | c cancel | l log mode | q quit
                {props.errorMessage ? ` | error: ${props.errorMessage}` : ""}
            </text>
        </box>
    );
}
