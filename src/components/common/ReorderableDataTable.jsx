import { useEffect, useMemo, useState } from 'react';
import { GripVertical } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const STORAGE_PREFIX = 'fcos:column_order';

function storageKey(tableKey) {
  return `${STORAGE_PREFIX}:${tableKey}`;
}

function readOrder(tableKey) {
  try {
    const raw = window.localStorage.getItem(storageKey(tableKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeOrder(tableKey, order) {
  try {
    window.localStorage.setItem(storageKey(tableKey), JSON.stringify(order));
  } catch {
    // Column order is a user preference. Ignore storage failures.
  }
}

function orderedColumns(columns, savedOrder) {
  const defaultIds = columns.map((column) => column.id);
  const savedIds = Array.isArray(savedOrder) ? savedOrder.filter((id) => defaultIds.includes(id)) : [];
  const missingIds = defaultIds.filter((id) => !savedIds.includes(id));
  const orderedIds = [...savedIds, ...missingIds];
  const byId = Object.fromEntries(columns.map((column) => [column.id, column]));
  return orderedIds.map((id) => byId[id]).filter(Boolean);
}

export default function ReorderableDataTable({
  tableKey,
  columns,
  rows,
  rowKey,
  loading = false,
  loadingTitle = 'Loading records',
  emptyIcon,
  emptyTitle = 'No records found',
  emptyDescription,
  isReorderEnabled = false,
  onRowClick,
  rowClassName,
  headerClassName = 'sticky top-0 z-10 bg-card',
  bodyEmptyColSpan,
}) {
  const [savedOrder, setSavedOrder] = useState(() => readOrder(tableKey));
  const [draggedColumn, setDraggedColumn] = useState(null);

  useEffect(() => {
    setSavedOrder(readOrder(tableKey));
  }, [tableKey]);

  const visibleColumns = useMemo(() => orderedColumns(columns, savedOrder), [columns, savedOrder]);

  const moveColumn = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const currentIds = visibleColumns.map((column) => column.id);
    const fromIndex = currentIds.indexOf(fromId);
    const toIndex = currentIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = currentIds.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSavedOrder(next);
    writeOrder(tableKey, next);
  };

  const resetOrder = () => {
    setSavedOrder(null);
    try {
      window.localStorage.removeItem(storageKey(tableKey));
    } catch {
      // Ignore storage failures.
    }
  };

  return (
    <div>
      {isReorderEnabled && (
        <div className="flex justify-end border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <button type="button" className="hover:text-foreground" onClick={resetOrder}>
            Reset column order
          </button>
        </div>
      )}
      <Table>
        <TableHeader className={headerClassName}>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableHead
                key={column.id}
                className={cn(column.headerClassName, isReorderEnabled && 'select-none')}
                draggable={isReorderEnabled}
                onDragStart={(event) => {
                  setDraggedColumn(column.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', column.id);
                }}
                onDragOver={(event) => {
                  if (isReorderEnabled) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!isReorderEnabled) return;
                  event.preventDefault();
                  moveColumn(draggedColumn || event.dataTransfer.getData('text/plain'), column.id);
                  setDraggedColumn(null);
                }}
                onDragEnd={() => setDraggedColumn(null)}
              >
                <span className="inline-flex items-center gap-1.5">
                  {isReorderEnabled && <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />}
                  {column.header}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={bodyEmptyColSpan || visibleColumns.length}>
                <StateBlock title={loadingTitle} description="Reading Salesforce records." />
              </TableCell>
            </TableRow>
          )}
          {!loading && !rows.length && (
            <TableRow>
              <TableCell colSpan={bodyEmptyColSpan || visibleColumns.length}>
                <StateBlock icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
              </TableCell>
            </TableRow>
          )}
          {!loading && rows.map((row, index) => (
            <TableRow
              key={rowKey ? rowKey(row, index) : row.id || index}
              className={cn(onRowClick && 'cursor-pointer', typeof rowClassName === 'function' ? rowClassName(row, index) : rowClassName)}
              onClick={() => onRowClick?.(row)}
            >
              {visibleColumns.map((column) => (
                <TableCell key={column.id} className={column.cellClassName}>
                  {column.cell(row, index)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
