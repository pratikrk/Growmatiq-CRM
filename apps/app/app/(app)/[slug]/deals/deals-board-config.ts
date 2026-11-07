export const DEALS_VIEWS = ["table", "board"] as const;

export type DealsView = (typeof DEALS_VIEWS)[number];

export const DEALS_BOARD = {
	pageSize: 100,
	defaultView: "table" satisfies DealsView,
} as const;
