import type { TaskRunTreeNode } from "@getbizi/client";
import { z } from "zod";
import { findActiveRunsInTaskSubtree } from "../lib/cli-task-runs";

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
	const activeRuns = dedupeRunsById(
		findActiveRunsInTaskSubtree(taskRuns, args.task)
	);

	if (activeRuns.length === 0) {
		process.stderr.write(
			`No active runs found for task "${args.task}" or its subtasks.\n`
		);
		return 1;
	}

	const outcomes = await Promise.all(
		activeRuns.map(async (run) => {
			try {
				const cancellation = await deps.cancelTask(run.id);
				return { run, ok: !cancellation.error };
			} catch {
				return { run, ok: false };
			}
		})
	);

	const successful = outcomes.filter((outcome) => outcome.ok);
	const failed = outcomes.filter((outcome) => !outcome.ok);

	if (successful.length > 0) {
		process.stdout.write(
			`Cancelled ${successful.length}/${outcomes.length} run(s) for "${args.task}" and its subtasks.\n`
		);
	}

	if (failed.length > 0) {
		const failedRunIds = failed.map((outcome) => outcome.run.id).join(", ");
		process.stderr.write(
			`Failed to cancel ${failed.length} run(s): ${failedRunIds}\n`
		);
		return 1;
	}

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

function dedupeRunsById(runs: TaskRunTreeNode[]): TaskRunTreeNode[] {
	const byId = new Map<string, TaskRunTreeNode>();
	for (const run of runs) {
		if (!byId.has(run.id)) {
			byId.set(run.id, run);
		}
	}
	return [...byId.values()];
}
