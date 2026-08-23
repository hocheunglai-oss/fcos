export function orderedColumns(columns, savedOrder) {
  const defaultIds = columns.map((column) => column.id);
  const savedIds = Array.isArray(savedOrder) ? savedOrder.filter((id) => defaultIds.includes(id)) : [];
  const missingIds = defaultIds.filter((id) => !savedIds.includes(id));
  const orderedIds = [...savedIds, ...missingIds];
  const byId = Object.fromEntries(columns.map((column) => [column.id, column]));
  return orderedIds.map((id) => byId[id]).filter(Boolean);
}

export function normalizedHiddenColumnIds(columns, value) {
  const allowed = new Set(columns.filter((column) => column.hideable !== false).map((column) => column.id));
  const hidden = [...new Set(Array.isArray(value) ? value.filter((id) => allowed.has(id)) : [])];
  const visibleCount = columns.filter((column) => !hidden.includes(column.id)).length;
  if (visibleCount > 0) return hidden;
  const fallbackId = columns.find((column) => column.hideable !== false)?.id;
  return fallbackId ? hidden.filter((id) => id !== fallbackId) : hidden;
}
