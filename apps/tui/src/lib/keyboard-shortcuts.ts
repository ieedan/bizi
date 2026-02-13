interface ShortcutKey {
	name: string;
	ctrl?: boolean;
	option?: boolean;
}

export function isJumpParentsForwardShortcut(
	key: ShortcutKey,
	isMacOs: boolean
): boolean {
	if (isMacOs) {
		return !!(key.option && (key.name === "down" || key.name === "j"));
	}
	return !!(key.ctrl && (key.name === "down" || key.name === "j"));
}

export function isJumpParentsBackwardShortcut(
	key: ShortcutKey,
	isMacOs: boolean
): boolean {
	if (isMacOs) {
		return !!(key.option && (key.name === "up" || key.name === "k"));
	}
	return !!(key.ctrl && (key.name === "up" || key.name === "k"));
}
