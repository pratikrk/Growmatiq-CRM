"use client";

import type { DealStage } from "@crm/db/enums";
import { KanbanBoard, type KanbanColumn } from "@crm/ui/components/kanban";
import { formatMoney } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CompanyCell } from "@/components/crm/company-cell";
import { DealStageIndicator } from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useMoveDealStage } from "@/components/crm/stage-change";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { LocalDay } from "@/components/local-date-time";
import { DEAL_STAGE_OPTIONS } from "@/lib/deal-stage";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { DEALS_BOARD } from "./deals-board-config";
import { dealsSearchParams } from "./deals-search-params";

type DealRow = RouterOutputs["deals"]["list"]["rows"][number];

type BoardItem = {
	id: string;
	columnId: string;
	label: string;
	deal: DealRow;
};

type ColumnTotal = { cents: number; uncounted: number };

function columnTotals(
	rows: DealRow[],
	reportingCurrency: string | undefined,
): Map<DealStage, ColumnTotal> {
	const totals = new Map<DealStage, ColumnTotal>();
	for (const row of rows) {
		const total = totals.get(row.stage) ?? { cents: 0, uncounted: 0 };
		if (row.amountCents !== null) {
			if (row.baseAmountCents !== null && reportingCurrency) {
				total.cents += row.baseAmountCents;
			} else {
				total.uncounted += 1;
			}
		}
		totals.set(row.stage, total);
	}
	return totals;
}

export function DealsBoard() {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const prefetchRecord = usePrefetchRecord();
	const { move } = useMoveDealStage();
	const { input } = useTableQuery(dealsSearchParams);

	const boardInput = {
		...input,
		page: 1,
		pageSize: DEALS_BOARD.pageSize,
		status: "all",
		stage: [],
		archived: false,
	};

	const deals = useQuery({
		...trpc.deals.list.queryOptions(boardInput),
		placeholderData: (previous) => previous,
	});

	const rows = deals.data?.rows ?? [];
	const total = deals.data?.total ?? 0;
	const reportingCurrency = deals.data?.reportingCurrency;

	const items = useMemo<BoardItem[]>(
		() =>
			rows.map((deal) => ({
				id: deal.id,
				columnId: deal.stage,
				label: deal.name,
				deal,
			})),
		[rows],
	);

	const columns = useMemo<KanbanColumn[]>(() => {
		const totals = columnTotals(rows, reportingCurrency);
		return DEAL_STAGE_OPTIONS.map((option) => {
			const sum = totals.get(option.value);
			const amount =
				sum && reportingCurrency && sum.cents > 0
					? formatMoney(sum.cents, reportingCurrency)
					: null;
			const uncounted =
				sum && sum.uncounted > 0 ? `${sum.uncounted} not counted` : null;
			return {
				id: option.value,
				title: <DealStageIndicator stage={option.value} />,
				meta: [amount, uncounted].filter(Boolean).join(" · ") || null,
			};
		});
	}, [rows, reportingCurrency]);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="w-full sm:max-w-xs">
					<ListSearch placeholder="Search deals by name or company…" />
				</div>
				<p className="text-xs text-muted-foreground tabular-nums">
					{total > rows.length
						? `Showing ${rows.length} of ${total} deals. Use search to narrow the board.`
						: `${total} deals`}
				</p>
			</div>
			<KanbanBoard
				columns={columns}
				items={items}
				empty="No deals"
				onMove={(item, toColumnId) =>
					move(item.deal.id, toColumnId as DealStage)
				}
				onOpen={(item) => openRecord({ kind: "deal", id: item.deal.id })}
				renderCard={(item) => (
					<DealCard
						deal={item.deal}
						onHover={() => prefetchRecord({ kind: "deal", id: item.deal.id })}
					/>
				)}
			/>
		</div>
	);
}

function DealCard({ deal, onHover }: { deal: DealRow; onHover: () => void }) {
	return (
		<div className="flex flex-col gap-2" onPointerEnter={onHover}>
			<p className="line-clamp-2 text-sm font-medium">{deal.name}</p>
			<div className="min-w-0 text-sm text-muted-foreground">
				<CompanyCell company={deal.company} />
			</div>
			<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
				<span className="tabular-nums text-foreground">
					{deal.amountCents === null
						? "No amount"
						: formatMoney(deal.amountCents, deal.currency)}
				</span>
				<span className="flex items-center gap-2">
					{deal.expectedCloseDate ? (
						<LocalDay date={deal.expectedCloseDate} />
					) : null}
					<OwnerCell owner={deal.owner} compact />
				</span>
			</div>
		</div>
	);
}
