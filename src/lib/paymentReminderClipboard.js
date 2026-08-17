function copyCell(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || '-';
}

export function paymentReminderCopyLine({ stemName, buyerName, amount, dueDate, status } = {}) {
  return [stemName, buyerName, amount, `Due Date ${copyCell(dueDate)}`, status]
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
