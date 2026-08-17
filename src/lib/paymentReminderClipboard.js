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
  const rowLines = rows.map((row) => paymentReminderCopyLine(row));
  const totals = totalLines.map((line) => copyCell(line).toUpperCase());
  return [
    ...rowLines,
    ...(rowLines.length && totals.length ? [''] : []),
    ...totals,
  ].join('\n');
}

export function accountStatementInvoiceCopyText(rows = [], totalLines = []) {
  const issued = rows.filter((row) => row?.invoiceIssued !== false);
  const notIssued = rows.filter((row) => row?.invoiceIssued === false);
  return paymentReminderCopyText([...issued, ...notIssued], totalLines);
}
