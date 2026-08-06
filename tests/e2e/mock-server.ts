/**
 * A stand-in for bizi-server.
 *
 * It speaks the same HTTP + WebSocket contract the real server does, but its
 * state is scripted by the scenario under test, so the end-to-end suite can
 * pin down exactly how a client reacts to a run that succeeds, fails, gets
 * cancelled, or never reports at all. It also records every request, which is
 * how scenarios assert that a client actually called `cancel` on the right
 * runs.
 */
import type { Task, TaskRunLogLine, TaskRunTreeNode } from "@getbizi/client";
import type { Server, ServerWebSocket } from "bun";

export interface TimelineStep {
	/** Milliseconds after the run is started. */
	afterMs: number;
	/** Append a log line to the run (or to `runId` when given). */
	log?: { line: string; isStderr?: boolean; task?: string; runId?: string };
	/** Move a run to a new status. Defaults to the run that was started. */
	status?: TaskRunTreeNode["status"];
	statusRunId?: string;
	/** Attach a child run to the started run. */
	addChild?: TaskRunTreeNode;
	/** Push an error frame down the log socket. */
	logError?: string;
}

export interface MockServerConfig {
	tasks: Record<string, Task>;
	runs: TaskRunTreeNode[];
	startRunId?: string;
	startedRun?: TaskRunTreeNode;
	timeline?: TimelineStep[];
	failListTasks?: boolean;
	failListRuns?: boolean;
	failStart?: boolean;
	failCancelRunIds?: string[];
	/** Reply to `POST /api/tasks/run` with an id that already exists. */
	startReturnsExistingRunId?: string;
	/**
	 * Lines already in storage before the client connects, so a subscription's
	 * opening snapshot has something in it.
	 */
	logsBeforeSubscribe?: { line: string; runId: string; task?: string }[];
}

export interface RecordedRequest {
	method: string;
	path: string;
	body?: unknown;
}

interface LogSocketData {
	kind: "logs";
	runId: string;
	includeChildren: boolean;
}

interface RunSocketData {
	kind: "run";
	runId: string;
}

type SocketData = LogSocketData | RunSocketData;

const ERROR_STATUS = 500;

export class MockBiziServer {
	readonly requests: RecordedRequest[] = [];

	private config: MockServerConfig;
	private runs: TaskRunTreeNode[];
	private logs: TaskRunLogLine[] = [];
	private sequence = 0;
	private server: Server | null = null;
	private timers: ReturnType<typeof setTimeout>[] = [];
	private readonly sockets = new Set<ServerWebSocket<SocketData>>();

	constructor(config: MockServerConfig) {
		this.config = config;
		this.runs = structuredClone(config.runs);
	}

	/**
	 * Points the running server at a new scenario. Reusing one listener across
	 * a whole file keeps the suite off the port-churn treadmill that comes from
	 * starting and stopping a server per test.
	 */
	reset(config: MockServerConfig): void {
		for (const timer of this.timers) {
			clearTimeout(timer);
		}
		this.timers = [];
		for (const socket of this.sockets) {
			socket.close();
		}
		this.sockets.clear();

		this.config = config;
		this.runs = structuredClone(config.runs);
		this.logs = [];
		this.sequence = 0;
		this.requests.length = 0;
	}

	get port(): number {
		if (!this.server) {
			throw new Error("server is not listening");
		}
		return this.server.port;
	}

	listen(): void {
		this.server = Bun.serve<SocketData, Record<string, never>>({
			port: 0,
			fetch: (request, server) => this.handleFetch(request, server),
			websocket: {
				open: (socket) => this.handleSocketOpen(socket),
				message: () => {
					/* clients never send frames */
				},
				close: (socket) => {
					this.sockets.delete(socket);
				},
			},
		});
	}

	async stop(): Promise<void> {
		for (const timer of this.timers) {
			clearTimeout(timer);
		}
		for (const socket of this.sockets) {
			socket.close();
		}
		this.sockets.clear();
		await this.server?.stop(true);
		this.server = null;
	}

	/** Requests as `"METHOD /path"`, with the run id appended for run actions. */
	requestSummaries(): string[] {
		return this.requests.map((request) => {
			const runId =
				typeof request.body === "object" &&
				request.body !== null &&
				"runId" in request.body
					? ` ${String((request.body as { runId: unknown }).runId)}`
					: "";
			const task =
				typeof request.body === "object" &&
				request.body !== null &&
				"task" in request.body
					? ` ${String((request.body as { task: unknown }).task)}`
					: "";
			return `${request.method} ${request.path}${runId}${task}`;
		});
	}

	// ------------------------------------------------------------------ HTTP

	private async handleFetch(
		request: Request,
		server: Server
	): Promise<Response | undefined> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			return this.handleUpgrade(request, server, url);
		}

		let body: unknown;
		if (request.method === "POST") {
			body = await request.json().catch(() => undefined);
		}
		// `includeChildren` is recorded because whether a client asks for the
		// aggregated view is part of the contract, not an implementation detail.
		const includeChildren = url.searchParams.get("includeChildren");
		this.requests.push({
			method: request.method,
			path:
				includeChildren === "true"
					? `${path}?includeChildren=true`
					: path,
			body,
		});

		if (path === "/api/tasks" && request.method === "GET") {
			if (this.config.failListTasks) {
				return errorResponse("no task config found");
			}
			return Response.json({ tasks: this.config.tasks });
		}

		if (path === "/api/tasks/runs" && request.method === "GET") {
			if (this.config.failListRuns) {
				return errorResponse("failed to read runs");
			}
			return Response.json({ taskRuns: this.runs });
		}

		if (path === "/api/tasks/run" && request.method === "POST") {
			return this.startRun();
		}

		if (path === "/api/tasks/cancel" && request.method === "POST") {
			return this.cancelRun(body);
		}

		if (path === "/api/tasks/restart" && request.method === "POST") {
			const runId = readRunId(body) ?? "run-restarted";
			return Response.json({ runId });
		}

		const logsMatch = path.match(/^\/api\/tasks\/([^/]+)\/logs$/);
		if (logsMatch && request.method === "GET") {
			const includeChildren =
				url.searchParams.get("includeChildren") === "true";
			const runId = decodeURIComponent(logsMatch[1] ?? "");
			return Response.json({
				runId,
				logs: this.logsFor(runId, includeChildren),
			});
		}

		const runMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
		if (runMatch && request.method === "GET") {
			const runId = decodeURIComponent(runMatch[1] ?? "");
			const run = this.findRun(runId);
			if (!run) {
				return errorResponse(`run "${runId}" not found`);
			}
			return Response.json({ taskRun: run });
		}

		return errorResponse(`unhandled ${request.method} ${path}`);
	}

	private handleUpgrade(
		request: Request,
		server: Server,
		url: URL
	): Response | undefined {
		const logsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/logs$/);
		if (logsMatch) {
			const data: LogSocketData = {
				kind: "logs",
				runId: decodeURIComponent(logsMatch[1] ?? ""),
				includeChildren:
					url.searchParams.get("includeChildren") === "true",
			};
			this.requests.push({
				method: "WS",
				path: `${url.pathname}${data.includeChildren ? "?includeChildren=true" : ""}`,
			});
			return server.upgrade(request, { data })
				? undefined
				: new Response("upgrade failed", { status: 400 });
		}

		const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
		if (runMatch) {
			const data: RunSocketData = {
				kind: "run",
				runId: decodeURIComponent(runMatch[1] ?? ""),
			};
			this.requests.push({ method: "WS", path: url.pathname });
			return server.upgrade(request, { data })
				? undefined
				: new Response("upgrade failed", { status: 400 });
		}

		return new Response("not found", { status: 404 });
	}

	private startRun(): Response {
		if (this.config.failStart) {
			return errorResponse("task not found");
		}

		if (this.config.startReturnsExistingRunId) {
			return Response.json({
				runId: this.config.startReturnsExistingRunId,
			});
		}

		const started = this.config.startedRun;
		if (started && !this.findRun(started.id)) {
			this.runs = [structuredClone(started), ...this.runs];
		}
		for (const buffered of this.config.logsBeforeSubscribe ?? []) {
			this.logs.push({
				runId: buffered.runId,
				sequence: this.sequence++,
				task:
					buffered.task ??
					this.findRun(buffered.runId)?.task ??
					"task",
				timestamp: 0,
				isStderr: false,
				line: buffered.line,
			});
		}
		this.scheduleTimeline();
		return Response.json({
			runId: this.config.startRunId ?? started?.id ?? "run-started",
		});
	}

	private cancelRun(body: unknown): Response {
		const runId = readRunId(body);
		if (!runId) {
			return errorResponse("missing runId");
		}
		if (this.config.failCancelRunIds?.includes(runId)) {
			return errorResponse(`cannot cancel "${runId}"`);
		}
		this.setStatus(runId, "Cancelled");
		return Response.json({ cancelledRunIds: [runId] });
	}

	// -------------------------------------------------------------- websocket

	private handleSocketOpen(socket: ServerWebSocket<SocketData>): void {
		this.sockets.add(socket);
		if (socket.data.kind === "logs") {
			socket.send(
				JSON.stringify({
					type: "snapshot",
					runId: socket.data.runId,
					logs: this.logsFor(
						socket.data.runId,
						socket.data.includeChildren
					),
				})
			);
			return;
		}
		const run = this.findRun(socket.data.runId);
		if (run) {
			socket.send(JSON.stringify({ taskRun: run }));
		}
	}

	private broadcastRun(runId: string): void {
		const run = this.findRun(runId);
		if (!run) {
			return;
		}
		const rootId = this.rootIdFor(runId) ?? runId;
		const rootRun = this.findRun(rootId);
		for (const socket of this.sockets) {
			if (socket.data.kind !== "run") {
				continue;
			}
			if (socket.data.runId === runId) {
				socket.send(JSON.stringify({ taskRun: run }));
			} else if (socket.data.runId === rootId && rootRun) {
				socket.send(JSON.stringify({ taskRun: rootRun }));
			}
		}
	}

	private broadcastLog(log: TaskRunLogLine): void {
		for (const socket of this.sockets) {
			if (socket.data.kind !== "logs") {
				continue;
			}
			const matchesRun = socket.data.runId === log.runId;
			const matchesTree =
				socket.data.includeChildren &&
				this.rootIdFor(log.runId) === this.rootIdFor(socket.data.runId);
			if (matchesRun || matchesTree) {
				socket.send(JSON.stringify({ type: "log", log }));
			}
		}
	}

	private broadcastLogError(message: string): void {
		for (const socket of this.sockets) {
			if (socket.data.kind === "logs") {
				socket.send(JSON.stringify({ type: "error", message }));
			}
		}
	}

	// --------------------------------------------------------------- timeline

	private scheduleTimeline(): void {
		const defaultRunId =
			this.config.startedRun?.id ??
			this.config.startRunId ??
			"run-started";
		for (const step of this.config.timeline ?? []) {
			this.timers.push(
				setTimeout(
					() => this.applyStep(step, defaultRunId),
					step.afterMs
				)
			);
		}
	}

	private applyStep(step: TimelineStep, defaultRunId: string): void {
		if (step.addChild) {
			this.attachChild(defaultRunId, structuredClone(step.addChild));
			this.broadcastRun(defaultRunId);
		}
		if (step.log) {
			const runId = step.log.runId ?? defaultRunId;
			const line: TaskRunLogLine = {
				runId,
				sequence: this.sequence++,
				task: step.log.task ?? this.findRun(runId)?.task ?? "task",
				timestamp: 0,
				isStderr: step.log.isStderr ?? false,
				line: step.log.line,
			};
			this.logs.push(line);
			this.broadcastLog(line);
		}
		if (step.logError) {
			this.broadcastLogError(step.logError);
		}
		if (step.status) {
			const runId = step.statusRunId ?? defaultRunId;
			this.setStatus(runId, step.status);
			this.broadcastRun(runId);
		}
	}

	// ----------------------------------------------------------------- state

	private setStatus(runId: string, status: TaskRunTreeNode["status"]): void {
		const run = this.findRun(runId);
		if (run) {
			run.status = status;
			run.updatedAt += 1;
		}
	}

	private attachChild(parentId: string, child: TaskRunTreeNode): void {
		const parent = this.findRun(parentId);
		if (parent && !this.findRun(child.id)) {
			parent.children.push(child);
		}
	}

	private findRun(runId: string): TaskRunTreeNode | undefined {
		const visit = (
			nodes: TaskRunTreeNode[]
		): TaskRunTreeNode | undefined => {
			for (const node of nodes) {
				if (node.id === runId) {
					return node;
				}
				const found = visit(node.children);
				if (found) {
					return found;
				}
			}
			return undefined;
		};
		return visit(this.runs);
	}

	private rootIdFor(runId: string): string | undefined {
		const visit = (
			nodes: TaskRunTreeNode[],
			rootId: string
		): string | undefined => {
			for (const node of nodes) {
				if (node.id === runId) {
					return rootId;
				}
				const found = visit(node.children, rootId);
				if (found) {
					return found;
				}
			}
			return undefined;
		};
		for (const root of this.runs) {
			const found = visit([root], root.id);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	private logsFor(runId: string, includeChildren: boolean): TaskRunLogLine[] {
		if (!includeChildren) {
			return this.logs.filter((log) => log.runId === runId);
		}
		const rootId = this.rootIdFor(runId);
		return this.logs.filter(
			(log) => this.rootIdFor(log.runId) === rootId || log.runId === runId
		);
	}
}

function readRunId(body: unknown): string | undefined {
	if (typeof body === "object" && body !== null && "runId" in body) {
		const runId = (body as { runId: unknown }).runId;
		return typeof runId === "string" ? runId : undefined;
	}
	return undefined;
}

function errorResponse(message: string): Response {
	return Response.json({ message }, { status: ERROR_STATUS });
}
