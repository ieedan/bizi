import { createBiziApi } from "@getbizi/client";

export const DEFAULT_BIZI_API_PORT = 7436;
export const DEFAULT_BIZI_API_HOST = "localhost";

/**
 * `BIZI_PORT`/`BIZI_HOST` point the client at a different server. Tests use it
 * to talk to a mock server instead of the machine's real one.
 */
export function resolveApiPort(
	value: string | undefined = process.env.BIZI_PORT
): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) {
		return parsed;
	}
	return DEFAULT_BIZI_API_PORT;
}

export function resolveApiHost(
	value: string | undefined = process.env.BIZI_HOST
): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_BIZI_API_HOST;
}

export const api = createBiziApi({
	port: resolveApiPort(),
	host: resolveApiHost(),
});
