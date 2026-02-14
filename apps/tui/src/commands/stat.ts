import type { TaskRunTreeNode } from "@task-runner/client-js";
import { z } from "zod";
import {
	findActiveRunByTaskKey,
	findLatestRunByTaskKey,
} from "../lib/cli-task-runs";

const statCommandArgsSchema = z.object({
	cwd: z.string().min(1),
	task: z.string().min(1),
	json: z.boolean(),
});

export type StatCommandArgs = z.infer<typeof statCommandArgsSchema>;

interface StatCommandDependencies {
	listTaskRuns: (cwd: string) => Promise<{ data?: unknown; error?: unknown }>;
}

export async function statCommand(
	input: unknown,
	deps: StatCommandDependencies
): Promise<number> {
	const args = statCommandArgsSchema.parse(input);
	const taskRuns = await listTaskRunsOrThrow(deps, args.cwd);
	const activeRun = findActiveRunByTaskKey(taskRuns, args.task);
	const latestRun = findLatestRunByTaskKey(taskRuns, args.task);

	const payload = {
		task: args.task,
		cwd: args.cwd,
		activeRun: activeRun
			? {
					id: activeRun.id,
					status: activeRun.status,
					updatedAt: activeRun.updatedAt,
				}
			: null,
		latestRun: latestRun
			? {
					id: latestRun.id,
					status: latestRun.status,
					updatedAt: latestRun.updatedAt,
				}
			: null,
	};

	if (args.json) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		return 0;
	}

	if (!latestRun) {
		process.stdout.write(`Task "${args.task}" has no recorded runs.\n`);
		return 0;
	}

	const activeSummary = activeRun
		? `active run ${activeRun.id} (${activeRun.status})`
		: "no active run";
	process.stdout.write(
		`Task "${args.task}": ${activeSummary}; latest run ${latestRun.id} (${latestRun.status}).\n`
	);
	return 0;
}

async function listTaskRunsOrThrow(
	deps: Pick<StatCommandDependencies, "listTaskRuns">,
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
