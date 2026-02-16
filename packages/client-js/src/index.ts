import createClient from "openapi-fetch";
import type { components, paths } from "./api";

export interface ClientOptions {
	/**
	 * The port to connect to the bizi service on. @default 7436
	 */
	port: number;
	/**
	 * The hostname to connect to. @default localhost
	 */
	host: string;
}

export type TaskRunTreeNode = components["schemas"]["TaskRunTreeNode"];
export type TaskRunLogLine = components["schemas"]["TaskRunLogLine"];
export type Task = components["schemas"]["Task"];
export type GetTaskRunResponse = components["schemas"]["GetTaskRunResponse"];
export type GetTaskRunLogsResponse =
	components["schemas"]["GetTaskRunLogsResponse"];

export interface TaskRunLogsSnapshotMessage {
	type: "snapshot";
	runId: string;
	logs: TaskRunLogLine[];
}

export interface TaskRunLogsLogMessage {
	type: "log";
	log: TaskRunLogLine;
}

export interface TaskRunLogsErrorMessage {
	type: "error";
	message: string;
}

export type TaskRunLogsStreamMessage =
	| TaskRunLogsSnapshotMessage
	| TaskRunLogsLogMessage
	| TaskRunLogsErrorMessage;

export function createBiziClient({
	port = 7436,
	host = "localhost",
}: Partial<ClientOptions> = {}) {
	return createClient<paths>({
		baseUrl: `http://${host}:${port}`,
	});
}

export function createBiziApi(options: Partial<ClientOptions> = {}) {
	const client = createBiziClient(options);
	const { port = 7436, host = "localhost" } = options;

	return {
		client,
		listTasks(cwd: string) {
			return client.GET("/api/tasks", {
				params: { query: { cwd } },
			});
		},
		listTaskRuns(cwd: string) {
			return client.GET("/api/tasks/runs", {
				params: { query: { cwd } },
			});
		},
		getTaskRun(runId: string) {
			return client.GET("/api/tasks/{run_id}", {
				params: { path: { run_id: runId } },
			});
		},
		getTaskRunLogs(runId: string, includeChildren = false) {
			return client.GET("/api/tasks/{run_id}/logs", {
				params: {
					path: { run_id: runId },
					query: { includeChildren },
				},
			});
		},
		runTask(task: string, cwd: string, includeTasks?: string[]) {
			return client.POST("/api/tasks/run", {
				body: { task, cwd, includeTasks },
			});
		},
		cancelTask(runId: string) {
			return client.POST("/api/tasks/cancel", {
				body: { runId },
			});
		},
		restartTask(runId: string) {
			return client.POST("/api/tasks/restart", {
				body: { runId },
			});
		},
		subscribeTaskRun(
			runId: string,
			handlers: {
				onMessage: (payload: GetTaskRunResponse) => void;
				onError?: (error: unknown) => void;
				onClose?: () => void;
			}
		) {
			return openJsonWebSocket<GetTaskRunResponse>(
				buildWsUrl(
					host,
					port,
					`/api/tasks/${encodeURIComponent(runId)}`
				),
				handlers
			);
		},
		subscribeTaskLogs(
			runId: string,
			handlers: {
				onMessage: (payload: TaskRunLogsStreamMessage) => void;
				onError?: (error: unknown) => void;
				onClose?: () => void;
			},
			options: { includeChildren?: boolean } = {}
		) {
			const query = options.includeChildren
				? "?includeChildren=true"
				: "";
			return openJsonWebSocket<TaskRunLogsStreamMessage>(
				buildWsUrl(
					host,
					port,
					`/api/tasks/${encodeURIComponent(runId)}/logs${query}`
				),
				handlers
			);
		},
	};
}

function buildWsUrl(host: string, port: number, pathname: string): string {
	return `ws://${host}:${port}${pathname}`;
}

function openJsonWebSocket<T>(
	url: string,
	handlers: {
		onMessage: (payload: T) => void;
		onError?: (error: unknown) => void;
		onClose?: () => void;
	}
) {
	const ws = new WebSocket(url);

	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string") {
			return;
		}

		try {
			const payload = JSON.parse(event.data) as T;
			handlers.onMessage(payload);
		} catch (error) {
			handlers.onError?.(error);
		}
	});

	ws.addEventListener("error", (event) => {
		handlers.onError?.(event);
	});

	ws.addEventListener("close", () => {
		handlers.onClose?.();
	});

	return ws;
}
