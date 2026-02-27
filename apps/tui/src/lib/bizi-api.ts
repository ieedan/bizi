import { createBiziApi } from "@getbizi/client";

const BIZI_API_PORT = 7436;

export const api = createBiziApi({ port: BIZI_API_PORT });
