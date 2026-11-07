"use client";

import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { DealsBoard } from "./deals-board";
import { DEALS_BOARD, DEALS_VIEWS, type DealsView } from "./deals-board-config";
import { DealsTable } from "./deals-table";

const viewParser = parseAsStringLiteral(DEALS_VIEWS).withDefault(
	DEALS_BOARD.defaultView,
);

function useDealsView() {
	return useQueryState(SEARCH_PARAM.deals.view, viewParser);
}

export function DealsViewToggle() {
	const [view, setView] = useDealsView();

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			value={view}
			onValueChange={(next) => {
				if (next) void setView(next as DealsView);
			}}
			aria-label="Deals view"
		>
			<ToggleGroupItem value="table">Table</ToggleGroupItem>
			<ToggleGroupItem value="board">Board</ToggleGroupItem>
		</ToggleGroup>
	);
}

export function DealsViews() {
	const [view] = useDealsView();
	return view === "board" ? <DealsBoard /> : <DealsTable />;
}
