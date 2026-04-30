import type { Renderable, Selection } from "@opentui/core";

/**
 * opentui's Selection.getSelectedText() sorts every selected renderable by
 * (y, x) and joins them with newlines. That breaks for log views where each
 * row contains multiple <text> children (timestamp, task tag, content) — each
 * sibling on the same row would become its own line in the copied output.
 *
 * Group selected renderables by their absolute y position so each visual row
 * is one line, then join siblings on that row left-to-right.
 */
export function getSelectedTextByRow(selection: Selection): string {
	const renderables = selection.selectedRenderables.filter(
		(renderable: Renderable) => !renderable.isDestroyed
	);
	if (renderables.length === 0) {
		return "";
	}

	const rowByY = new Map<number, Renderable[]>();
	for (const renderable of renderables) {
		const existing = rowByY.get(renderable.y);
		if (existing) {
			existing.push(renderable);
		} else {
			rowByY.set(renderable.y, [renderable]);
		}
	}

	const sortedYs = [...rowByY.keys()].sort((a, b) => a - b);
	const lines: string[] = [];
	for (const y of sortedYs) {
		const row = rowByY.get(y);
		if (!row) {
			continue;
		}
		row.sort((a, b) => a.x - b.x);
		const rowText = row
			.map((renderable) => renderable.getSelectedText())
			.filter((text) => text.length > 0)
			.join(" ");
		if (rowText.length > 0) {
			lines.push(rowText);
		}
	}

	return lines.join("\n").replace(/\s+$/g, "");
}
