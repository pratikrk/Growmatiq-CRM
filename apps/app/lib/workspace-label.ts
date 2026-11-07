export function workspaceLabel(name: string | undefined): string {
	const trimmed = name?.trim();

	return trimmed ? trimmed : "Growmatiq";
}
