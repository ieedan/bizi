import type { TaskRunTreeNode } from "@task-runner/client-js";
import { z } from "zod";
import { findActiveRunByTaskKey } from "../lib/cli-task-runs";
import { canCancelRun } from "../lib/task-runs";

const cancelCommandArgsSchema = z.object({
	cwd: z.string().min(1),
	task: z.string().min(1),
});

export type CancelCommandArgs = z.infer<typeof cancelCommandArgsSchema>;

interface CancelCommandDependencies {
	listTaskRuns: (cwd: string) => Promise<{ data?: unknown; error?: unknown }>;
	cancelTask: (runId: string) => Promise<{ data?: unknown; error?: unknown }>;
}

export async function cancelCommand(
	input: unknown,
	deps: CancelCommandDependencies
): Promise<number> {
	const args = cancelCommandArgsSchema.parse(input);
	const taskRuns = await listTaskRunsOrThrow(deps, args.cwd);
	const activeRun = findActiveRunByTaskKey(taskRuns, args.task);

	if (!activeRun) {
		process.stderr.write(`No active run found for task "${args.task}".\n`);
		return 1;
	}
	if (!canCancelRun(activeRun)) {
		process.stderr.write(`Task "${args.task}" cannot be cancelled.\n`);
		return 1;
	}

	const cancellation = await deps.cancelTask(activeRun.id);
	if (cancellation.error) {
		process.stderr.write(`Failed to cancel task "${args.task}".\n`);
		return 1;
	}

	process.stdout.write(`Cancelled task "${args.task}" (${activeRun.id}).\n`);
	return 0;
}

async function listTaskRunsOrThrow(
	deps: Pick<CancelCommandDependencies, "listTaskRuns">,
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
