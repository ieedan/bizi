import type { TaskRunTreeNode } from "@getbizi/client";
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
	getTaskRunLogs: (
		runId: string,
		includeChildren?: boolean
	) => Promise<{ data?: unknown; error?: unknown }>;
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

	let settled = false;
	let signalExitCode: number | null = null;
	let cancelFallbackTimer: NodeJS.Timeout | null = null;
	let handlingSignal = false;
	let terminalFinalizing = false;
	let resolveRun: ((code: number) => void) | null = null;
	const seenLogKeys = new Set<string>();

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

	const emitLog = (log: {
		runId?: string;
		sequence?: number;
		isStderr: boolean;
		line: string;
	}) => {
		const key =
			typeof log.runId === "string" && typeof log.sequence === "number"
				? `${log.runId}:${log.sequence}`
				: null;
		if (key) {
			if (seenLogKeys.has(key)) {
				return;
			}
			seenLogKeys.add(key);
		}
		printTaskLogLine(log);
	};

	const flushAggregatedLogs = async (): Promise<number> => {
		let emittedCount = 0;
		const logsResponse = await deps.getTaskRunLogs(runId, true);
		if (
			logsResponse.error ||
			!logsResponse.data ||
			!isTaskRunLogsResponse(logsResponse.data)
		) {
			return emittedCount;
		}
		for (const log of logsResponse.data.logs) {
			const beforeSize = seenLogKeys.size;
			emitLog(log);
			if (seenLogKeys.size > beforeSize) {
				emittedCount += 1;
			}
		}
		return emittedCount;
	};

	const finalizeWithStatus = async (status: TaskRunTreeNode["status"]) => {
		if (terminalFinalizing || settled) {
			return;
		}
		terminalFinalizing = true;
		try {
			// Give logs a brief chance to catch up in storage after terminal status.
			for (let attempt = 0; attempt < 4; attempt += 1) {
				await flushAggregatedLogs();
				if (attempt === 3) {
					break;
				}
				await wait(180);
			}
		} catch {
			// Best-effort flush; status-based exit should still continue.
		}
		const exitCode = signalExitCode ?? taskRunStatusExitCode(status);
		complete(exitCode);
	};

	const logSocket = deps.subscribeTaskLogs(
		runId,
		{
			onMessage: (payload) => {
				if (!isTaskLogMessage(payload)) {
					return;
				}
				if (payload.type === "snapshot") {
					for (const line of payload.logs) {
						emitLog(line);
					}
					return;
				}
				if (payload.type === "log") {
					emitLog(payload.log);
					return;
				}
				process.stderr.write(`${payload.message}\n`);
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
			finalizeWithStatus(payload.taskRun.status).catch(() => {
				const exitCode =
					signalExitCode ??
					taskRunStatusExitCode(payload.taskRun.status);
				complete(exitCode);
			});
		},
		onError: () => {
			/* intentional no-op */
		},
	});

	const statusPoller = setInterval(() => {
		if (settled || terminalFinalizing) {
			return;
		}
		deps.getTaskRun(runId)
			.then((latestRun) => {
				if (
					!latestRun.data ||
					latestRun.error ||
					!isTaskRunMessage(latestRun.data)
				) {
					return;
				}
				if (!isTerminalRunStatus(latestRun.data.taskRun.status)) {
					return;
				}
				return finalizeWithStatus(latestRun.data.taskRun.status);
			})
			.catch(() => undefined);
	}, 500);

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
		const exitCode = await runPromise;
		return exitCode;
	} finally {
		clearInterval(statusPoller);
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
	| { type: "log"; log: { isStderr: boolean; line: string } }
	| { type: "error"; message: string } {
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
				data.log !== null) ||
			(data.type === "error" &&
				"message" in data &&
				typeof data.message === "string"))
	);
}

function isTaskRunLogsResponse(data: unknown): data is {
	logs: Array<{
		runId: string;
		sequence: number;
		isStderr: boolean;
		line: string;
	}>;
} {
	return (
		typeof data === "object" &&
		data !== null &&
		"logs" in data &&
		Array.isArray(data.logs)
	);
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
