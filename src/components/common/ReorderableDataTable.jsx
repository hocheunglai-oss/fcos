import { useEffect, useMemo, useState } from 'react';
import { Columns3, GripVertical, RotateCcw } from 'lucide-react';
import StateBlock from '@/components/common/StateBlock';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { normalizedHiddenColumnIds, orderedColumns } from '@/lib/tablePreferences';
import { cn } from '@/lib/utils';

const STORAGE_PREFIX = 'fcos:column_order';
const VISIBILITY_STORAGE_PREFIX = 'fcos:column_visibility:v1';

function storageKey(tableKey) {
  return `${STORAGE_PREFIX}:${tableKey}`;
}

function visibilityStorageKey(tableKey) {
  return `${VISIBILITY_STORAGE_PREFIX}:${tableKey}`;
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

function readHiddenColumns(tableKey) {
  try {
    const raw = window.localStorage.getItem(visibilityStorageKey(tableKey));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeHiddenColumns(tableKey, hiddenIds) {
  try {
    window.localStorage.setItem(visibilityStorageKey(tableKey), JSON.stringify(hiddenIds));
  } catch {
    // Column visibility is a user preference. Ignore storage failures.
  }
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
  isColumnVisibilityEnabled = true,
  rowClassName,
  headerClassName = 'sticky top-0 z-10 bg-card',
  bodyEmptyColSpan,
}) {
  const [savedOrder, setSavedOrder] = useState(() => readOrder(tableKey));
  const [hiddenColumns, setHiddenColumns] = useState(() => readHiddenColumns(tableKey));
  const [draggedColumn, setDraggedColumn] = useState(null);

  useEffect(() => {
    setSavedOrder(readOrder(tableKey));
    setHiddenColumns(readHiddenColumns(tableKey));
  }, [tableKey]);

  const normalizedHiddenColumns = useMemo(
    () => normalizedHiddenColumnIds(columns, hiddenColumns),
    [columns, hiddenColumns],
  );
  const visibleColumns = useMemo(
    () => orderedColumns(columns, savedOrder).filter((column) => !normalizedHiddenColumns.includes(column.id)),
    [columns, normalizedHiddenColumns, savedOrder],
  );

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

  const setColumnVisible = (columnId, visible) => {
    const next = visible
      ? normalizedHiddenColumns.filter((id) => id !== columnId)
      : normalizedHiddenColumnIds(columns, [...normalizedHiddenColumns, columnId]);
    setHiddenColumns(next);
    writeHiddenColumns(tableKey, next);
  };

  const resetColumns = () => {
    resetOrder();
    setHiddenColumns([]);
    try {
      window.localStorage.removeItem(visibilityStorageKey(tableKey));
    } catch {
      // Ignore storage failures.
    }
  };

  const configurableColumns = columns.filter((column) => column.hideable !== false);
  const showControls = isReorderEnabled || (isColumnVisibilityEnabled && configurableColumns.length > 1);

  return (
    <div className="min-w-0">
      {showControls && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {isColumnVisibilityEnabled && configurableColumns.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                  <Columns3 className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {configurableColumns.map((column) => {
                  const visible = !normalizedHiddenColumns.includes(column.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={visible}
                      disabled={visible && visibleColumns.length === 1}
                      onCheckedChange={(checked) => setColumnVisible(column.id, checked === true)}
                    >
                      {column.header}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={resetColumns}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset columns
          </Button>
        </div>
      )}
      <Table scrollLabel={`${tableKey.replaceAll('-', ' ')} table`}>
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
              className={cn(typeof rowClassName === 'function' ? rowClassName(row, index) : rowClassName)}
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
