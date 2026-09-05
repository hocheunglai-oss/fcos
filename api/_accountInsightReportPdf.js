import { jsPDF } from 'jspdf';

const PORTRAIT = { width: 210, height: 297, orientation: 'portrait' };
const LANDSCAPE = { width: 297, height: 210, orientation: 'landscape' };
const BLUE = [15, 55, 88];
const INK = [31, 41, 55];
const MUTED = [71, 85, 105];

function text(value, fallback = 'Unavailable') { const valueText = String(value ?? '').trim(); return valueText || fallback; }
function number(value) { if (value == null || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function money(value, currency) { const parsed = number(value); return parsed == null ? 'Unavailable' : `${text(currency, '') ? `${currency} ` : ''}${parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function quantity(value) { const parsed = number(value); return parsed == null ? 'Unavailable' : parsed.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function title(value) { return String(value ?? 'Account').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Account'; }
function filename(model, today) { return `${String(today).replace(/-/g, '')} ${title(model?.identity?.name)} Account Insight.pdf`; }

function setup(doc, model, options, size, continued = false) {
  const side = size.orientation === 'landscape' ? 12 : 14;
  const width = size.width - side * 2;
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(continued ? 11 : 14);
  const nameLines = doc.splitTextToSize(text(model?.identity?.name, 'Account Insight'), width - 4);
  const headerHeight = Math.max(29, 19 + nameLines.length * 4.5);
  doc.setFillColor(...BLUE); doc.rect(0, 0, size.width, headerHeight, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(nameLines, side, continued ? 10 : 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  const headerY = 12 + nameLines.length * 4.5;
  doc.text(`${text(model?.audience).toUpperCase()} REPORT${model?.audience === 'internal' ? ' - Confidential - Internal use' : ''}${continued ? ' - Continued' : ''}`, side, headerY);
  doc.text(`Generated ${options.today} - ${text(options.actorName, 'FCOS user')}`, side, headerY + 5);
  return { doc, model, options, size, x: side, width, bottom: size.height - 15, y: Math.max(headerHeight + 8, headerY + 15) };
}
function addPage(context, landscape = context.size.orientation === 'landscape') {
  const size = landscape ? LANDSCAPE : PORTRAIT;
  context.doc.addPage('a4', size.orientation);
  Object.assign(context, setup(context.doc, context.model, context.options, size, true));
}
function ensure(context, height, landscape = context.size.orientation === 'landscape') {
  if (context.y + height <= context.bottom && context.size.orientation === (landscape ? 'landscape' : 'portrait')) return;
  addPage(context, landscape);
}
function sectionTitle(context, value, subtitle = '', section = null) {
  const currentSection = section || context.currentSection;
  const direction = currentSection?.direction === 'buyer' ? 'Buyer direction' : currentSection?.direction === 'supplier' ? 'Supplier direction' : '';
  const completeSubtitle = [direction, subtitle].filter(Boolean).join(' - ');
  ensure(context, completeSubtitle ? 17 : 12);
  const { doc, x, width } = context;
  doc.setFillColor(239, 246, 255); doc.rect(x, context.y - 5, width, completeSubtitle ? 13 : 9, 'F');
  doc.setTextColor(30, 64, 175); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(value, x + 3, context.y + 1);
  if (completeSubtitle) { doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.7); doc.text(text(completeSubtitle, ''), x + 3, context.y + 6); }
  context.y += completeSubtitle ? 17 : 11;
}
function paragraph(context, value) {
  const lines = context.doc.splitTextToSize(text(value), context.width - 5);
  ensure(context, Math.max(7, lines.length * 4.2 + 4));
  context.doc.setTextColor(...INK); context.doc.setFont('helvetica', 'normal'); context.doc.setFontSize(7.4);
  context.doc.text(lines, context.x + 2, context.y); context.y += Math.max(7, lines.length * 4.2 + 4);
}
function table(context, headers, rows, widths, aligns = []) {
  const declaredWidth = widths.reduce((sum, width) => sum + width, 0);
  const normalizedWidths = declaredWidth > 0 && Math.abs(declaredWidth - context.width) > 0.01 ? widths.map((width) => width * context.width / declaredWidth) : widths;
  const drawHeader = () => {
    const headerLines = headers.map((header, index) => context.doc.splitTextToSize(text(header, ''), Math.max(8, normalizedWidths[index] - 4)));
    const headerHeight = Math.max(7, ...headerLines.map((lines) => lines.length * 3.1 + 2.5));
    ensure(context, headerHeight + 2);
    let x = context.x; context.doc.setFillColor(30, 64, 175); context.doc.setTextColor(255, 255, 255); context.doc.setFont('helvetica', 'bold'); context.doc.setFontSize(6.7);
    headers.forEach((header, index) => { context.doc.setFillColor(30, 64, 175); context.doc.rect(x, context.y, normalizedWidths[index], headerHeight, 'F'); context.doc.setTextColor(255, 255, 255); context.doc.text(headerLines[index], aligns[index] === 'right' ? x + normalizedWidths[index] - 2 : x + 2, context.y + 4, aligns[index] === 'right' ? { align: 'right' } : {}); x += normalizedWidths[index]; });
    context.y += headerHeight;
  };
  drawHeader();
  const drawCells = (cells, height, tone) => {
    context.doc.setFont('helvetica', 'normal'); context.doc.setFontSize(6.8);
    let x = context.x;
    cells.forEach((lines, index) => { context.doc.setFillColor(tone, tone, tone); context.doc.rect(x, context.y, normalizedWidths[index], height, 'F'); context.doc.setTextColor(...INK); context.doc.text(lines, aligns[index] === 'right' ? x + normalizedWidths[index] - 2 : x + 2, context.y + 4.3, aligns[index] === 'right' ? { align: 'right' } : {}); x += normalizedWidths[index]; });
    context.y += height;
  };
  rows.forEach((row, rowIndex) => {
    context.doc.setFont('helvetica', 'normal'); context.doc.setFontSize(6.8);
    const cells = row.map((cell, index) => context.doc.splitTextToSize(text(cell, '—'), Math.max(8, normalizedWidths[index] - 4)));
    const tone = rowIndex % 2 ? 248 : 255;
    let offset = 0;
    const longest = Math.max(...cells.map((lines) => lines.length));
    while (offset < longest) {
      const availableLines = Math.max(1, Math.floor((context.bottom - context.y - 3) / 3.45));
      const take = Math.min(availableLines, longest - offset);
      const part = cells.map((lines) => lines.slice(offset, offset + take));
      const height = Math.max(8, ...part.map((lines) => lines.length * 3.45 + 3));
      if (context.y + height > context.bottom) { addPage(context, context.size.orientation === 'landscape'); drawHeader(); continue; }
      drawCells(part, height, tone);
      offset += take;
    }
  });
  context.y += 5;
}
function chart(context, rows) {
  if (!rows.length) return;
  ensure(context, 48);
  const values = rows.map((row) => { const quantityValue = number(row.quantity); return quantityValue == null ? (number(row.stemCount) ?? 0) : quantityValue; });
  const minimum = Math.min(0, ...values); const maximum = Math.max(0, ...values); const range = Math.max(1, maximum - minimum);
  const chartWidth = context.width - 10; const gap = 3; const barWidth = Math.max(3, (chartWidth - gap * (rows.length - 1)) / rows.length);
  const plotTop = context.y + 6; const plotHeight = 25; const baseline = plotTop + (maximum / range) * plotHeight;
  context.doc.setDrawColor(203, 213, 225); context.doc.line(context.x + 4, baseline, context.x + 4 + chartWidth, baseline);
  context.doc.setTextColor(...MUTED); context.doc.setFontSize(5.5); context.doc.text(quantity(maximum), context.x + 4, plotTop - 1); context.doc.text(quantity(minimum), context.x + 4, plotTop + plotHeight + 5);
  rows.forEach((row, index) => { const value = values[index]; const endpoint = plotTop + ((maximum - value) / range) * plotHeight; const x = context.x + 5 + index * (barWidth + gap); context.doc.setFillColor(37, 99, 235); context.doc.rect(x, Math.min(baseline, endpoint), barWidth, Math.abs(endpoint - baseline), 'F'); context.doc.setFontSize(5.8); context.doc.setTextColor(...MUTED); const label = text(row.period || row.label, '').slice(0, 11); context.doc.text(label, x + barWidth / 2, plotTop + plotHeight + 9, { align: 'center', angle: 0 }); });
  context.y += 43;
}
function stepChart(context, rows) {
  if (!rows.length) return;
  ensure(context, 45);
  const points = rows.map((row) => ({ ...row, value: number(row.balance), time: Date.parse(row.date) })).filter((row) => Number.isFinite(row.time));
  const values = points.map((row) => row.value).filter((value) => value != null); if (!values.length) { paragraph(context, 'No dated balance points are available for this forecast.'); return; }
  const minimum = Math.min(0, ...values); const maximum = Math.max(0, ...values); const range = Math.max(1, maximum - minimum); const first = Math.min(...points.map((row) => row.time)); const last = Math.max(...points.map((row) => row.time));
  const left = context.x + 5; const top = context.y + 6; const plotHeight = 20; const baseline = top + (maximum / range) * plotHeight; const width = context.width - 10;
  context.doc.setDrawColor(203, 213, 225); context.doc.line(left, baseline, left + width, baseline);
  context.doc.setTextColor(...MUTED); context.doc.setFontSize(5.5); context.doc.text(money(maximum, rows[0]?.currency), left, top - 1); context.doc.text(money(minimum, rows[0]?.currency), left, top + plotHeight + 5);
  let previous = null;
  points.forEach((row) => { if (row.value == null) { previous = null; return; } const x = left + (last === first ? width / 2 : ((row.time - first) / (last - first)) * width); const y = top + ((maximum - row.value) / range) * plotHeight; context.doc.setDrawColor(37, 99, 235); context.doc.setLineWidth(0.8); if (previous) { context.doc.line(previous.x, previous.y, x, previous.y); context.doc.line(x, previous.y, x, y); } context.doc.setFillColor(37, 99, 235); context.doc.circle(x, y, 1.2, 'F'); context.doc.setTextColor(...MUTED); context.doc.setFontSize(5.8); context.doc.text(text(row.date, '').slice(0, 10), x, top + plotHeight + 9, { align: 'center' }); previous = { x, y }; });
  context.y += 38;
}
function monthlyCharts(context, rows, currency) {
  const series = [
    { label: 'Volume MT', key: 'quantity', color: [123, 146, 111] },
    { label: `Gross profit${currency ? ` ${currency}` : ''}`, key: 'grossProfit', color: [172, 105, 81] },
    { label: 'Gross margin %', key: 'grossMarginPct', color: [119, 86, 116] },
  ];
  ensure(context, 42);
  const gap = 4; const width = (context.width - gap * 2) / 3; const top = context.y + 4;
  series.forEach((entry, index) => {
    const x = context.x + index * (width + gap); const values = rows.map((row) => number(row[entry.key])).filter((value) => value != null); const minimum = Math.min(0, ...values); const maximum = Math.max(0, ...values); const range = Math.max(1, maximum - minimum); const baseline = top + 25 - ((0 - minimum) / range) * 19;
    context.doc.setTextColor(...MUTED); context.doc.setFontSize(6.3); context.doc.text(entry.label, x, context.y);
    context.doc.setDrawColor(203, 213, 225); context.doc.line(x, baseline, x + width, baseline); context.doc.setFontSize(5.3); context.doc.setTextColor(...MUTED); context.doc.text(quantity(maximum), x, top + 4); context.doc.text(quantity(minimum), x, top + 29);
    let previous = null;
    rows.forEach((row, rowIndex) => { const value = number(row[entry.key]); if (value == null) { previous = null; return; } const pointX = x + (rows.length <= 1 ? width / 2 : rowIndex * width / (rows.length - 1)); const pointY = top + 25 - ((value - minimum) / range) * 19; context.doc.setDrawColor(...entry.color); context.doc.setLineWidth(0.65); if (previous) context.doc.line(previous.x, previous.y, pointX, pointY); context.doc.setFillColor(...entry.color); context.doc.circle(pointX, pointY, 1, 'F'); previous = { x: pointX, y: pointY }; });
  });
  context.y += 35;
}
const labels = { stem: 'STEM', date: 'Delivery', expectedDate: 'Expected', status: 'Status', currency: 'Currency', vessel: 'Vessel', port: 'Port', product: 'Products', quantity: 'Quantity', invoice: 'Invoice', payments: 'Payments', balance: 'Balance', dueDate: 'Due date', age: 'Age', invoiceCount: 'Invoices', paymentCount: 'Payments', collectionStatus: 'Collection status', grossProfit: 'Gross profit', grossMargin: 'Gross margin' };
function cell(row, id) {
  if (id === 'product') return row.products?.map((product) => product.unit ? `${product.name} (${quantity(product.quantity)} ${product.unit})` : product.name).join('; ') || 'Unavailable';
  if (id === 'quantity') return quantity(row.quantity);
  if (id === 'invoice' || id === 'payments' || id === 'balance' || id === 'grossProfit') return money(row[id], row.currency);
  if (id === 'grossMargin') return number(row.grossMarginPct) == null ? 'Unavailable' : `${number(row.grossMarginPct).toFixed(2)}%`;
  if (id === 'age') return number(row.age) == null ? 'Unavailable' : `${quantity(row.age)} days`;
  return text(row[id]);
}
function widthsFor(columns, width) {
  const shares = { stem: 1.15, date: .85, expectedDate: .85, status: .9, currency: .65, vessel: 1.2, port: 1.1, product: 1.7, quantity: .9, invoice: 1.15, payments: 1.15, balance: 1.15, dueDate: .85, age: .65, invoiceCount: .75, paymentCount: .75, collectionStatus: 1.15, grossProfit: 1.15, grossMargin: .9 };
  const total = columns.reduce((sum, id) => sum + (shares[id] || 1), 0); return columns.map((id) => width * (shares[id] || 1) / total);
}
function renderSection(context, section) {
  context.currentSection = section;
  if (section.id === 'profile') { sectionTitle(context, 'Account profile'); paragraph(context, `${section.identity?.name || context.model.identity?.name || 'Account'}${section.identity?.clKey ? ` - CL Key ${section.identity.clKey}` : ''}. Scope: ${section.period?.label || 'Selected period'}. Accounts in scope: ${quantity(section.scope?.accountCount)}.`); return; }
  if (section.id === 'trading') { sectionTitle(context, 'Trading summary'); const rows = (section.financials || []).map((row) => context.model.audience === 'internal' ? [text(row.currency), quantity(section.stemCount), quantity(section.quantity), money(row.turnover, row.currency), money(row.grossProfit, row.currency)] : [text(row.currency), quantity(section.stemCount), quantity(section.quantity), 'Directionally reported']); table(context, context.model.audience === 'internal' ? ['Currency', 'STEMs', 'Quantity', 'Turnover', 'Gross profit'] : ['Currency', 'STEMs', 'Quantity', 'Reporting basis'], rows, context.model.audience === 'internal' ? [30, 28, 34, 45, 45] : [38, 36, 47, 106], ['left', 'right', 'right', 'right', 'right']); if (context.model.audience === 'internal' && section.directions?.length) { sectionTitle(context, 'Directional settlements', 'Buyer and supplier values are separate; FCOS does not net opposite legs.'); table(context, ['Currency', 'Buyer invoices', 'Buyer payments', 'Buyer balance', 'Supplier invoices', 'Supplier paid', 'Supplier payable'], section.directions.map((row) => [row.currency, money(row.buyer.invoice, row.currency), money(row.buyer.payments, row.currency), money(row.buyer.balance, row.currency), money(row.supplier.invoice, row.currency), money(row.supplier.payments, row.currency), money(row.supplier.balance, row.currency)]), [22, 27, 27, 27, 27, 27, 25], ['left', 'right', 'right', 'right', 'right', 'right', 'right']); } return; }
  if (section.id === 'monthly') { sectionTitle(context, 'Monthly activity', section.currency ? `Currency: ${section.currency}. Monthly figures are not combined across currencies.` : 'Figures are separated by currency.'); if (context.model.config.includeCharts && context.model.audience === 'internal') monthlyCharts(context, section.rows || [], section.currency); else if (context.model.config.includeCharts) chart(context, section.rows || []); table(context, ['Period', 'Quantity', ...(context.model.audience === 'internal' ? ['Gross profit', 'Gross margin'] : [])], (section.rows || []).map((row) => [row.period, quantity(row.quantity), ...(context.model.audience === 'internal' ? [money(row.grossProfit, row.currency || section.currency), number(row.grossMarginPct) == null ? 'Unavailable' : `${number(row.grossMarginPct).toFixed(2)}%`] : [])]), context.model.audience === 'internal' ? [52, 46, 48, 36] : [76, 106], ['left', 'right', 'right', 'right']); return; }
  if (section.id === 'products' || section.id === 'ports') { sectionTitle(context, section.id === 'products' ? 'Products' : 'Ports'); table(context, [section.id === 'products' ? 'Product' : 'Port', 'STEMs', 'Quantity'], (section.rows || []).map((row) => [row.label, quantity(row.stemCount), quantity(row.quantity)]), [context.width - 85, 35, 50], ['left', 'right', 'right']); return; }
  if (section.id === 'children') { sectionTitle(context, 'Trading accounts'); table(context, ['Account', 'CL Key', 'STEMs', 'Quantity', 'Gross profit'], (section.rows || []).map((row) => [row.name, row.clKey, quantity(row.stemCount), quantity(row.quantity), money(row.grossProfit)]), [55, 28, 25, 35, 39], ['left', 'left', 'right', 'right', 'right']); return; }
  if (section.id === 'credit') { sectionTitle(context, 'Credit overview', section.currency ? `Currency: ${section.currency}` : 'Credit authority and own outstanding balances.'); const authority = section.authority || {}; if (authority.name || authority.limit != null || authority.used != null || authority.available != null) table(context, ['Authority', 'Limit', 'Used', 'Available'], [[authority.name, money(authority.limit, authority.currency || section.currency), money(authority.used, authority.currency || section.currency), money(authority.available, authority.currency || section.currency)]], [50, 44, 44, 44], ['left', 'right', 'right', 'right']); if (section.rows?.length) table(context, ['Currency', 'Own invoice', 'Own paid / received', 'Own balance'], section.rows.map((row) => [row.currency, money(row.invoice, row.currency), money(row.paid ?? row.payments, row.currency), money(row.balance, row.currency)]), [30, 50, 50, 52], ['left', 'right', 'right', 'right']); return; }
  if (section.id === 'payments') { sectionTitle(context, 'Payments', section.currency ? `Currency: ${section.currency}. Own payment activity only.` : 'Own payment activity; currencies are separate.'); table(context, ['Currency', 'Invoice', 'Paid / received', 'Balance'], (section.rows || []).map((row) => [row.currency, money(row.invoice, row.currency), money(row.paid ?? row.payments, row.currency), money(row.balance, row.currency)]), [30, 50, 50, 52], ['left', 'right', 'right', 'right']); if (section.history?.length) { sectionTitle(context, 'Payment history', 'Detailed own-direction payment evidence.'); table(context, ['STEM', 'Payment reference', 'Payment date', 'Currency', 'Amount'], section.history.map((row) => [row.stem, row.reference, row.date, row.currency, money(row.amount, row.currency)]), [34, 60, 31, 22, 35], ['left', 'left', 'left', 'left', 'right']); } return; }
  if (section.id === 'aging') { sectionTitle(context, 'Aging'); table(context, ['Bucket', 'Currency', 'Outstanding balance'], (section.rows || []).map((row) => [row.bucket, row.currency, money(row.balance, row.currency)]), [70, 35, 77], ['left', 'left', 'right']); return; }
  if (section.id === 'forecast') { sectionTitle(context, 'Forecast', section.currency ? `Currency: ${section.currency}. Actual authoritative forecast points.` : 'Actual authoritative forecast points.'); if (context.model.config.includeCharts) stepChart(context, section.rows || []); table(context, ['Date', 'Leg', 'Currency', 'Balance'], (section.rows || []).map((row) => [row.date, row.leg, row.currency, money(row.balance, row.currency)]), [48, 38, 30, 66], ['left', 'left', 'left', 'right']); return; }
  if (section.id === 'statement') { if (context.size.orientation !== 'landscape') addPage(context, true); sectionTitle(context, 'Statement', section.direction ? `Direction: ${section.direction}. Currency: ${section.currency || 'separate'}.` : 'Party-facing statement values.'); table(context, ['STEM', 'Delivery', 'Invoice state', 'Currency', 'Invoice', ...(section.includeExpected ? ['Expected'] : []), 'Paid / received', 'Balance', 'Due date'], (section.rows || []).map((row) => [row.stem, row.date, row.invoiceState, row.currency, money(row.invoice, row.currency), ...(section.includeExpected ? [money(row.expectedAmount, row.currency)] : []), money(row.paid ?? row.payments, row.currency), money(row.balance, row.currency), row.dueDate]), section.includeExpected ? [35, 28, 38, 22, 38, 38, 38, 38, 22] : [42, 32, 42, 24, 42, 42, 42, 25], ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'left']); return; }
  if (section.id === 'stems') { sectionTitle(context, 'STEM detail', `${context.model.detailCount.toLocaleString('en-US')} row${context.model.detailCount === 1 ? '' : 's'} included`); if (context.model.config.depth !== 'detail') { paragraph(context, 'Summary depth selected. The full STEM appendix is omitted.'); return; } if (context.size.orientation !== 'landscape') addPage(context, true); const columns = section.columns || []; table(context, columns.map((id) => labels[id] || id), (section.rows || []).map((row) => columns.map((id) => cell(row, id))), widthsFor(columns, context.width), columns.map((id) => ['quantity', 'invoice', 'payments', 'balance', 'age', 'invoiceCount', 'paymentCount', 'grossProfit', 'grossMargin'].includes(id) ? 'right' : 'left')); return; }
  if (section.id === 'risks') { sectionTitle(context, 'Risks and exceptions'); paragraph(context, `Open disputes: ${quantity(section.openDisputes)}. Exceptions: ${quantity(section.exceptions)}.`); return; }
  if (section.id === 'methodology') { if (context.size.orientation === 'landscape') addPage(context, false); sectionTitle(context, 'Methodology and source notes'); paragraph(context, section.basis); paragraph(context, `Source timestamp: ${section.sourceTimestamp || context.model.generatedFrom?.sourceTimestamp || context.model.sourceTimestamp || 'Unavailable'}. Scope: ${section.scope || context.model.scopeLabel || 'Selected account and period'}.`); (section.reliability || []).forEach((warning) => paragraph(context, `Data note: ${warning}`)); paragraph(context, 'Reliability warning: use only the displayed account direction and source evidence. Amounts remain separated by currency and unavailable values are not zero.'); }
}
function renderMandatoryProvenance(context) {
  const source = context.model.generatedFrom?.sourceTimestamp || context.model.sourceTimestamp || 'Unavailable';
  if (context.size.orientation === 'landscape') addPage(context, false);
  context.currentSection = null;
  sectionTitle(context, 'Source and reliability');
  const provenance = context.model.generatedFrom || {};
  paragraph(context, `Source timestamp: ${source}. Trading period: ${provenance.period || context.model.scopeLabel || 'Selected period'}. Scope: ${provenance.filterScope || 'Selected account'}.`);
  if (provenance.statementTimestamp) paragraph(context, `Current credit exposure as of ${provenance.statementTimestamp}.`);
  if (provenance.accountScope?.length) paragraph(context, `Included Accounts: ${provenance.accountScope.map((account) => `${account.name}${account.clKey ? ` (${account.clKey})` : ''}`).join('; ')}.`);
  paragraph(context, 'Reliability warning: payment data is reliable from 1 January 2026. Earlier settled commercial history has unavailable payment metrics. Amounts remain separated by currency and unavailable values are not zero.');
}
function footers(context) {
  const total = context.doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) { context.doc.setPage(page); const pageSize = context.doc.internal.pageSize; const width = pageSize.getWidth(); const height = pageSize.getHeight(); context.doc.setDrawColor(226, 232, 240); context.doc.line(12, height - 10, width - 12, height - 10); context.doc.setTextColor(...MUTED); context.doc.setFontSize(6.6); context.doc.text(`FCOS Account Insight${context.model.audience === 'internal' ? ' - Confidential - Internal use' : ''}`, 12, height - 6); context.doc.text(`Page ${page} of ${total}`, width - 12, height - 6, { align: 'right' }); }
}

export function buildAccountInsightReportPdf(reportModel, { actorName, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } = {}) {
  if (!reportModel || !Array.isArray(reportModel.sections)) throw new TypeError('A projected Account Insight report model is required.');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: false });
  const context = setup(doc, reportModel, { actorName, today }, PORTRAIT);
  reportModel.sections.forEach((section) => renderSection(context, section));
  renderMandatoryProvenance(context);
  footers(context);
  return { buffer: Buffer.from(doc.output('arraybuffer')), filename: filename(reportModel, today), contentType: 'application/pdf' };
}
