import createClient from 'openapi-fetch';
import type { paths } from './api';

export type ClientOptions = {
    /**
     * The port to connect to the task runner service on. @default 7436
     */
    port: number;
}

export function createTaskRunnerClient({ port = 7436 }: Partial<ClientOptions> = {}) {
    return createClient<paths>({
        baseUrl: `http://localhost:${port}`,
    });
}

