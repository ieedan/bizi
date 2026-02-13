type StatusFooterProps = {
    isMacOs: boolean;
    errorMessage: string | null;
};

export function StatusFooter(props: StatusFooterProps) {
    return (
        <box border={["left", "right", "bottom"]} borderColor="#666666" paddingLeft={1}>
            <text>
                arrows/jk move | jump parents:{" "}
                {props.isMacOs ? "option+up/down or option+k/j" : "ctrl+up/down or ctrl+k/j"} | r
                run/restart (auto) | c cancel | l log mode | q quit
                {props.errorMessage ? ` | error: ${props.errorMessage}` : ""}
            </text>
        </box>
    );
}
