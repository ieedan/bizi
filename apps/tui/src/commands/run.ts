import type { TaskRunTreeNode } from "@task-runner/client-js";
import { z } from "zod";
import { promptCancelBeforeExit } from "../lib/cli-prompts";
import {
	findActiveRunByTaskKey,
	isTerminalRunStatus,
	taskRunStatusExitCode,
} from "../lib/cli-task-runs";

const runCommandArgsSchema = z.object({
	cwd: z.string().min(1),
	task: z.string().min(1),
	nonInteractive: z.boolean(),
	implicit: z.boolean(),
});

export type RunCommandArgs = z.infer<typeof runCommandArgsSchema>;

interface RunCommandDependencies {
	runTask: (
		task: string,
		cwd: string,
		includeTasks?: string[]
	) => Promise<{ data?: unknown; error?: unknown }>;
	listTaskRuns: (cwd: string) => Promise<{ data?: unknown; error?: unknown }>;
	getTaskRun: (runId: string) => Promise<{ data?: unknown; error?: unknown }>;
	subscribeTaskRun: (
		runId: string,
		handlers: {
			onMessage: (payload: unknown) => void;
			onError?: (error: unknown) => void;
			onClose?: () => void;
		}
	) => WebSocket;
	subscribeTaskLogs: (
		runId: string,
		handlers: {
			onMessage: (payload: unknown) => void;
			onError?: (error: unknown) => void;
			onClose?: () => void;
		},
		options?: { includeChildren?: boolean }
	) => WebSocket;
	cancelTask: (runId: string) => Promise<{ data?: unknown; error?: unknown }>;
}

export async function runCommand(
	input: unknown,
	deps: RunCommandDependencies
): Promise<number> {
	const args = runCommandArgsSchema.parse(input);
	const interactive = process.stdout.isTTY && !args.nonInteractive;

	const beforeTaskRuns = await listTaskRunsOrThrow(deps, args.cwd);
	const activeBeforeRun = findActiveRunByTaskKey(beforeTaskRuns, args.task);

	const startResult = await deps.runTask(args.task, args.cwd);
	if (
		startResult.error ||
		!startResult.data ||
		!isStartTaskResponse(startResult.data)
	) {
		throw new Error(`failed to start task "${args.task}"`);
	}
	const runId = startResult.data.runId;
	const startedBySession = activeBeforeRun?.id !== runId;
	if (args.implicit && process.stdout.isTTY) {
		process.stdout.write(
			`Running task "${args.task}" (implicit run mode).\n`
		);
	}

	let settled = false;
	let signalExitCode: number | null = null;
	let cancelFallbackTimer: NodeJS.Timeout | null = null;
	let handlingSignal = false;
	let resolveRun: ((code: number) => void) | null = null;

	const complete = (code: number) => {
		if (settled) {
			return;
		}
		settled = true;
		if (cancelFallbackTimer) {
			clearTimeout(cancelFallbackTimer);
		}
		resolveRun?.(code);
	};

	const runPromise = new Promise<number>((resolve) => {
		resolveRun = resolve;
	});

	const logSocket = deps.subscribeTaskLogs(
		runId,
		{
			onMessage: (payload) => {
				if (!isTaskLogMessage(payload)) {
					return;
				}
				if (payload.type === "snapshot") {
					for (const line of payload.logs) {
						printTaskLogLine(line);
					}
					return;
				}
				if (payload.type === "log") {
					printTaskLogLine(payload.log);
				}
			},
		},
		{ includeChildren: true }
	);

	const runSocket = deps.subscribeTaskRun(runId, {
		onMessage: (payload) => {
			if (!isTaskRunMessage(payload)) {
				return;
			}
			if (!isTerminalRunStatus(payload.taskRun.status)) {
				return;
			}
			const exitCode =
				signalExitCode ?? taskRunStatusExitCode(payload.taskRun.status);
			complete(exitCode);
		},
		onError: () => {
			/* intentional no-op */
		},
	});

	const clearSignalHandlers = registerSignalHandlers(async () => {
		if (handlingSignal || settled) {
			return;
		}
		handlingSignal = true;
		try {
			if (interactive) {
				const shouldCancel = await promptCancelBeforeExit(args.task);
				if (!shouldCancel) {
					complete(130);
					return;
				}
				signalExitCode = 130;
				await deps.cancelTask(runId);
				cancelFallbackTimer = setTimeout(() => complete(130), 3000);
				return;
			}

			if (startedBySession) {
				signalExitCode = 130;
				await deps.cancelTask(runId);
				cancelFallbackTimer = setTimeout(() => complete(130), 3000);
				return;
			}

			complete(130);
		} finally {
			handlingSignal = false;
		}
	});

	try {
		const latestRun = await deps.getTaskRun(runId);
		if (
			!latestRun.error &&
			latestRun.data &&
			isTaskRunMessage(latestRun.data) &&
			isTerminalRunStatus(latestRun.data.taskRun.status)
		) {
			const exitCode =
				signalExitCode ??
				taskRunStatusExitCode(latestRun.data.taskRun.status);
			complete(exitCode);
		}

		const exitCode = await runPromise;
		return exitCode;
	} finally {
		clearSignalHandlers();
		logSocket.close();
		runSocket.close();
	}
}

async function listTaskRunsOrThrow(
	deps: Pick<RunCommandDependencies, "listTaskRuns">,
	cwd: string
) {
	const response = await deps.listTaskRuns(cwd);
	if (
		response.error ||
		!response.data ||
		!isTaskRunsResponse(response.data)
	) {
		throw new Error("failed to load task runs");
	}
	return response.data.taskRuns;
}

function printTaskLogLine(log: { isStderr: boolean; line: string }) {
	const stream = log.isStderr ? process.stderr : process.stdout;
	stream.write(log.line.endsWith("\n") ? log.line : `${log.line}\n`);
}

function registerSignalHandlers(onSignal: () => Promise<void>): () => void {
	const handler = () => {
		onSignal().catch(() => undefined);
	};
	process.on("SIGINT", handler);
	process.on("SIGTERM", handler);
	return () => {
		process.off("SIGINT", handler);
		process.off("SIGTERM", handler);
	};
}

function isStartTaskResponse(data: unknown): data is { runId: string } {
	return (
		typeof data === "object" &&
		data !== null &&
		"runId" in data &&
		typeof data.runId === "string"
	);
}

function isTaskRunsResponse(
	data: unknown
): data is { taskRuns: TaskRunTreeNode[] } {
	return (
		typeof data === "object" &&
		data !== null &&
		"taskRuns" in data &&
		Array.isArray(data.taskRuns)
	);
}

function isTaskRunMessage(data: unknown): data is { taskRun: TaskRunTreeNode } {
	return (
		typeof data === "object" &&
		data !== null &&
		"taskRun" in data &&
		typeof data.taskRun === "object" &&
		data.taskRun !== null
	);
}

function isTaskLogMessage(
	data: unknown
): data is
	| { type: "snapshot"; logs: Array<{ isStderr: boolean; line: string }> }
	| { type: "log"; log: { isStderr: boolean; line: string } } {
	return (
		typeof data === "object" &&
		data !== null &&
		"type" in data &&
		((data.type === "snapshot" &&
			"logs" in data &&
			Array.isArray(data.logs)) ||
			(data.type === "log" &&
				"log" in data &&
				typeof data.log === "object" &&
				data.log !== null))
	);
}
