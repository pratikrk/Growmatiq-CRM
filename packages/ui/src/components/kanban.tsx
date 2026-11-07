"use client";

import {
	closestCorners,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { cn } from "@crm/ui/lib/utils";
import { type ReactNode, useRef, useState } from "react";

export type KanbanColumn = {
	id: string;
	title: ReactNode;
	meta?: ReactNode;
};

export type KanbanItem = {
	id: string;
	columnId: string;
	label: string;
};

export function KanbanBoard<TItem extends KanbanItem>({
	columns,
	items,
	renderCard,
	onMove,
	onOpen,
	empty = "Nothing here.",
	className,
}: {
	columns: KanbanColumn[];
	items: TItem[];
	renderCard: (item: TItem) => ReactNode;
	onMove: (item: TItem, toColumnId: string) => void;
	onOpen?: (item: TItem) => void;
	empty?: ReactNode;
	className?: string;
}) {
	const [activeId, setActiveId] = useState<string | null>(null);
	const justDropped = useRef(false);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			keyboardCodes: {
				start: ["Space"],
				cancel: ["Escape"],
				end: ["Space", "Enter"],
			},
		}),
	);

	const active = items.find((item) => item.id === activeId) ?? null;

	const open = onOpen
		? (item: TItem) => {
				if (justDropped.current) return;
				onOpen(item);
			}
		: undefined;

	const onDragStart = (event: DragStartEvent) => {
		setActiveId(String(event.active.id));
	};

	const onDragEnd = (event: DragEndEvent) => {
		setActiveId(null);
		justDropped.current = true;
		window.setTimeout(() => {
			justDropped.current = false;
		}, 0);
		const item = items.find((entry) => entry.id === String(event.active.id));
		const toColumnId = event.over ? String(event.over.id) : null;
		if (!item || !toColumnId || toColumnId === item.columnId) return;
		onMove(item, toColumnId);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCorners}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragCancel={() => setActiveId(null)}
		>
			<div
				data-slot="kanban"
				className={cn(
					"flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2",
					className,
				)}
			>
				{columns.map((column) => (
					<KanbanLane
						key={column.id}
						column={column}
						items={items.filter((item) => item.columnId === column.id)}
						renderCard={renderCard}
						onOpen={open}
						empty={empty}
					/>
				))}
			</div>
			<DragOverlay>
				{active ? (
					<div className="cursor-grabbing rounded-lg border bg-background p-3 shadow-md">
						{renderCard(active)}
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

function KanbanLane<TItem extends KanbanItem>({
	column,
	items,
	renderCard,
	onOpen,
	empty,
}: {
	column: KanbanColumn;
	items: TItem[];
	renderCard: (item: TItem) => ReactNode;
	onOpen?: (item: TItem) => void;
	empty: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: column.id });

	return (
		<section
			ref={setNodeRef}
			data-slot="kanban-column"
			aria-label={typeof column.title === "string" ? column.title : undefined}
			className={cn(
				"flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2 transition-colors",
				isOver && "border-ring bg-muted",
			)}
		>
			<header className="flex flex-col gap-0.5 px-1 pt-1">
				<div className="flex items-center justify-between gap-2 text-sm font-medium">
					{column.title}
					<span className="text-xs text-muted-foreground tabular-nums">
						{items.length}
					</span>
				</div>
				{column.meta ? (
					<div className="text-xs text-muted-foreground tabular-nums">
						{column.meta}
					</div>
				) : null}
			</header>
			<div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto">
				{items.length === 0 ? (
					<p className="px-1 py-4 text-center text-xs text-muted-foreground">
						{empty}
					</p>
				) : (
					items.map((item) => (
						<KanbanCard key={item.id} item={item} onOpen={onOpen}>
							{renderCard(item)}
						</KanbanCard>
					))
				)}
			</div>
		</section>
	);
}

function KanbanCard<TItem extends KanbanItem>({
	item,
	onOpen,
	children,
}: {
	item: TItem;
	onOpen?: (item: TItem) => void;
	children: ReactNode;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: item.id,
	});

	return (
		<div
			ref={setNodeRef}
			data-slot="kanban-card"
			{...attributes}
			{...listeners}
			aria-label={item.label}
			onClick={() => onOpen?.(item)}
			onKeyDown={(event) => {
				if (event.key === "Enter") onOpen?.(item);
			}}
			className={cn(
				"cursor-grab rounded-lg border bg-background p-3 text-left outline-none transition-colors hover:border-ring/60 focus-visible:border-ring",
				isDragging && "opacity-40",
			)}
		>
			{children}
		</div>
	);
}
