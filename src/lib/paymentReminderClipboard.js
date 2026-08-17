function copyCell(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim() || '-';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function expectedInvoiceFields(row = {}) {
  const amount = `${copyCell(row.amountLabel || 'Expected Invoice Amount')} ${copyCell(row.amount)}`.toUpperCase();
  const amountSuffix = String(row.amountSuffix ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const dueDate = `${copyCell(row.dueDateLabel || 'Expected Due Date')} ${copyCell(row.dueDate)}`.toUpperCase();
  return { amount, amountSuffix, dueDate };
}

function accountStatementInvoiceCopyLine(row = {}) {
  if (row.invoiceIssued !== false) return paymentReminderCopyLine(row);
  const { amount, amountSuffix, dueDate } = expectedInvoiceFields(row);
  return [
    copyCell(row.stemName).toUpperCase(),
    copyCell(row.buyerName).toUpperCase(),
    `*${amount}*${amountSuffix ? ` ${amountSuffix}` : ''}`,
    `*${dueDate}*`,
  ].join(' - ');
}

function accountStatementInvoiceCopyLineHtml(row = {}) {
  if (row.invoiceIssued !== false) return escapeHtml(paymentReminderCopyLine(row));
  const { amount, amountSuffix, dueDate } = expectedInvoiceFields(row);
  return [
    escapeHtml(copyCell(row.stemName).toUpperCase()),
    escapeHtml(copyCell(row.buyerName).toUpperCase()),
    `<span style="text-decoration:underline;">${escapeHtml(amount)}</span>${amountSuffix ? ` ${escapeHtml(amountSuffix)}` : ''}`,
    `<span style="text-decoration:underline;">${escapeHtml(dueDate)}</span>`,
  ].join(' - ');
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
  return accountStatementInvoiceCopyPayload(rows, totalLines).text;
}

export function accountStatementInvoiceCopyPayload(rows = [], totalLines = []) {
  const issued = rows.filter((row) => row?.invoiceIssued !== false);
  const notIssued = rows.filter((row) => row?.invoiceIssued === false);
  const orderedRows = [...issued, ...notIssued];
  const rowLines = orderedRows.map(accountStatementInvoiceCopyLine);
  const totals = totalLines.map((line) => copyCell(line).toUpperCase());
  const text = [
    ...rowLines,
    ...(rowLines.length && totals.length ? [''] : []),
    ...totals,
  ].join('\n');
  const htmlRows = orderedRows.map((row) => `<div style="font-family:Arial,sans-serif;font-size:12px;color:#111827;">${accountStatementInvoiceCopyLineHtml(row)}</div>`);
  const htmlTotals = totals.map((line) => `<div style="font-family:Arial,sans-serif;font-size:12px;color:#111827;">${escapeHtml(line)}</div>`);
  const html = [
    ...htmlRows,
    ...(htmlRows.length && htmlTotals.length ? ['<div><br></div>'] : []),
    ...htmlTotals,
  ].join('');
  return { text, html };
}
