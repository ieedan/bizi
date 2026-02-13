export function parseCwdArg(argv: string[]): string | null {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === "--cwd") {
            return argv[index + 1] ?? null;
        }
        if (arg.startsWith("--cwd=")) {
            return arg.slice("--cwd=".length);
        }
    }
    return null;
}
