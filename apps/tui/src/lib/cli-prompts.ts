import { confirm, isCancel } from "@clack/prompts";

export async function promptCancelBeforeExit(task: string): Promise<boolean> {
	const response = await confirm({
		message: `Cancel task "${task}" before exiting?`,
		initialValue: true,
	});
	if (isCancel(response)) {
		return false;
	}
	return response;
}
