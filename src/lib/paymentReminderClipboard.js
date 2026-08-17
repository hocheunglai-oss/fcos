function copyCell(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || '-';
}

export function paymentReminderCopyLine({ stemName, buyerName, amount, dueDate, dueDateLabel = 'Due Date', status } = {}) {
  const cells = [stemName, buyerName, amount, `${copyCell(dueDateLabel)} ${copyCell(dueDate)}`];
  if (String(status ?? '').trim()) cells.push(status);
  return cells
    .map(copyCell)
    .join(' - ')
    .toUpperCase();
}

export function paymentReminderCopyText(rows = [], totalLines = []) {
  return [
    ...rows.map((row) => paymentReminderCopyLine(row)),
    ...totalLines.map((line) => copyCell(line).toUpperCase()),
  ].join('\n');
}
