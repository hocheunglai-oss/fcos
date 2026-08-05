import { jsPDF } from 'jspdf';

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvCell(value) {
  const output = value == null ? '' : String(value);
  return /[",\r\n]/.test(output) ? `"${output.replace(/"/g, '""')}"` : output;
}

function filenameToken(value) {
  return text(value).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Account';
}

function hongKongToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function money(value, currency = '') {
  const parsed = number(value);
  if (parsed == null) return 'Unavailable';
  return `${currency ? `${currency} ` : ''}${parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function metric(value, suffix = '') {
  const parsed = number(value);
  if (parsed == null) return 'Unavailable';
  return `${parsed.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
}

function accountInsightFilename(insight, extension, today) {
  const identity = insight.identity || {};
  return `${today.replace(/-/g, '')} ${filenameToken(identity.name)} ${filenameToken(identity.clKey || 'No CL Key')} Account Insight.${extension}`;
}

function csvRows(insight) {
  const headers = [
    'Row Type', 'Account Name', 'CL Key', 'Account ID', 'Role', 'STEM', 'STEM ID', 'Buyer', 'Buyer CL Key', 'Buyer Group',
    'Delivery Date', 'Expected Delivery Date', 'Effective Date', 'Invoice Sent Date', 'Due Date', 'Status', 'Dispute Status', 'Currency', 'Port', 'Country', 'Vessel',
    'Products', 'Product Families', 'Volume MT', 'Turnover Allocation', 'Supplier Cost Allocation', 'Gross Profit Allocation', 'Gross Margin %',
    'Buyer Invoice Amount', 'Buyer Payments Received', 'Receivable Balance', 'Latest Buyer Payment Date', 'Broker Commissions', 'Extra Cost Amount', 'Supplier Allocation %',
    'Supplier Invoice Amount', 'Supplier Paid Amount', 'Supplier Payable', 'Latest Supplier Payment Date', 'Cancelled Lines', 'Cancelled Extra Costs',
    'Collection Status', 'Reconciliation State', 'Buyer Payment Count', 'Supplier Invoice Count', 'Data Warnings',
  ];
  const rows = (insight.exportRows || insight.stems?.rows || []).map((row) => {
    return [
      'STEM', insight.identity?.name, insight.identity?.clKey, insight.identity?.accountId, insight.activeRole, row.stemName, row.stemId,
      row.buyerName, row.buyerClKey, row.buyerGroupName, row.deliveryDate, row.expectedDeliveryDate, row.effectiveDate, row.invoiceDate, row.dueDate, row.status,
      row.disputeStatus, row.currency, row.portName, row.portCountry, row.vesselName, (row.products || []).map((item) => item.name).join(' | '),
      [...new Set((row.products || []).map((item) => item.family))].join(' | '), row.volumeMt, row.turnover, row.spend, row.grossProfit,
      row.grossMarginPct, row.invoiceAmount, row.buyerPaymentsReceived, row.receivableBalance, row.latestBuyerPaymentDate, row.brokerCommissions, row.extraCostAmount, row.supplierAllocation?.share == null ? null : row.supplierAllocation.share * 100,
      row.supplierInvoiceAmount, row.supplierPaidAmount, row.supplierPayable, row.latestSupplierPaymentDate,
      row.cancelledLineCount, row.cancelledExtraCostCount, row.collectionStatus || '', row.reconciliationState || '',
      row.buyerPaymentCount ?? '', row.supplierInvoiceCount ?? '', '',
    ];
  });
  const kpis = insight.kpis || {};
  if ((kpis.moneyByCurrency || []).length > 1) {
    for (const total of kpis.moneyByCurrency) {
      rows.push([
        'CURRENCY TOTAL', insight.identity?.name, insight.identity?.clKey, insight.identity?.accountId, insight.activeRole,
        `${total.currency} totals`, '', '', '', '', '', '', '', '', '', '', '', total.currency, '', '', '', '', '', '',
        total.turnover, total.supplierSpend, total.grossProfit, total.grossMarginPct, '', '', '', '', total.brokerCommissions, total.extraCosts,
        '', '', '', '', '', '', '', '', '', '', '', '', '',
      ]);
    }
  }
  rows.push([
    'TOTALS', insight.identity?.name, insight.identity?.clKey, insight.identity?.accountId, insight.activeRole, `${kpis.stemCount || 0} STEMs`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    kpis.totalVolumeMt, kpis.turnover, kpis.supplierSpend, kpis.grossProfit, kpis.grossMarginPct, '', '', '', '', '', '', '', '', '', '', '', kpis.cancelledChildRecords, '', '', '', insight.payments?.buyer?.paymentCount ?? '', insight.payments?.supplier?.rows?.length ?? '', (insight.warnings || []).join(' | '),
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function addWrappedText(doc, value, x, y, width, options = {}) {
  const lines = doc.splitTextToSize(text(value) || 'Unavailable', width);
  doc.text(lines, x, y, options);
  return y + lines.length * 4.6;
}

function ensurePage(doc, y, required = 24) {
  if (y + required <= 282) return y;
  doc.addPage();
  return 18;
}

function drawSectionTitle(doc, title, y) {
  const nextY = ensurePage(doc, y, 14);
  doc.setFillColor(239, 246, 255);
  doc.rect(14, nextY - 5, 182, 9, 'F');
  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(title, 17, nextY + 1);
  doc.setTextColor(31, 41, 55);
  return nextY + 10;
}

function drawKpiGrid(doc, items, startY) {
  let y = startY;
  const columns = 3;
  const width = 58;
  const height = 19;
  items.forEach((item, index) => {
    if (index > 0 && index % columns === 0) y += height + 3;
    y = ensurePage(doc, y, height + 4);
    const column = index % columns;
    const x = 14 + column * (width + 4);
    doc.setDrawColor(214, 220, 229);
    doc.setFillColor(250, 251, 252);
    doc.roundedRect(x, y, width, height, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    const valueLines = doc.splitTextToSize(text(item.value), width - 8).slice(0, 2);
    doc.text(valueLines, x + 4, y + 13);
  });
  return y + height + 6;
}

function drawTrend(doc, trend, startY) {
  if (!trend?.length) return startY;
  let y = ensurePage(doc, startY, 50);
  const recent = trend.slice(-12);
  const max = Math.max(1, ...recent.map((row) => Math.abs(number(row.grossProfit) || 0)));
  const chartX = 18;
  const chartY = y + 32;
  const chartWidth = 174;
  const barWidth = chartWidth / recent.length;
  doc.setDrawColor(203, 213, 225);
  doc.line(chartX, chartY, chartX + chartWidth, chartY);
  recent.forEach((row, index) => {
    const value = number(row.grossProfit) || 0;
    const height = (Math.abs(value) / max) * 24;
    doc.setFillColor(value >= 0 ? 16 : 239, value >= 0 ? 185 : 68, value >= 0 ? 129 : 68);
    doc.rect(chartX + index * barWidth + 1, value >= 0 ? chartY - height : chartY, Math.max(2, barWidth - 2), height, 'F');
    doc.setFontSize(5.5);
    doc.setTextColor(100, 116, 139);
    doc.text(text(row.period).slice(2), chartX + index * barWidth + barWidth / 2, chartY + 5, { align: 'center' });
  });
  return y + 43;
}

function drawTable(doc, headers, rows, widths, startY) {
  let y = startY;
  const drawHeader = () => {
    y = ensurePage(doc, y, 14);
    doc.setFillColor(30, 64, 175);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    let x = 14;
    headers.forEach((header, index) => {
      doc.rect(x, y, widths[index], 8, 'F');
      doc.text(header, x + 2, y + 5);
      x += widths[index];
    });
    y += 8;
  };
  drawHeader();
  rows.forEach((row, rowIndex) => {
    if (y + 10 > 282) {
      doc.addPage();
      y = 18;
      drawHeader();
    }
    const fill = rowIndex % 2 ? 248 : 255;
    doc.setFillColor(fill, fill, fill);
    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    let x = 14;
    row.forEach((cell, index) => {
      doc.rect(x, y, widths[index], 10, 'F');
      const lines = doc.splitTextToSize(text(cell) || '—', widths[index] - 4).slice(0, 2);
      doc.text(lines, x + 2, y + 4);
      x += widths[index];
    });
    y += 10;
  });
  return y + 5;
}

function pdfBuffer(insight, actor, generatedAt) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const identity = insight.identity || {};
  doc.setFillColor(15, 55, 88);
  doc.rect(0, 0, 210, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text(identity.name || 'Account Insight', 14, 14);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text([identity.clKey ? `CL Key ${identity.clKey}` : 'CL Key not set', `${text(insight.activeRole).toUpperCase()} · ${insight.period?.label || ''}`], 14, 22);
  doc.setFontSize(7.5);
  doc.text(`Generated ${generatedAt} · ${actor || 'FCOS user'}`, 14, 30);
  let y = 45;
  const kpis = insight.kpis || {};
  const financialRows = kpis.moneyByCurrency || [];
  const financialCurrency = financialRows.length === 1 ? financialRows[0].currency : '';
  const financialKpi = (value) => financialRows.length === 1 ? money(value, financialCurrency) : financialRows.length ? `${financialRows.length} currencies` : 'Unavailable';
  y = drawKpiGrid(doc, [
    { label: 'STEMs', value: metric(kpis.stemCount) },
    { label: 'Volume', value: metric(kpis.totalVolumeMt, ' MT') },
    { label: insight.activeRole === 'supplier' ? 'Allocated revenue' : 'Turnover', value: financialKpi(kpis.turnover) },
    { label: 'Supplier spend', value: financialKpi(kpis.supplierSpend) },
    { label: 'Gross profit', value: financialKpi(kpis.grossProfit) },
    { label: 'Gross margin', value: metric(kpis.grossMarginPct, '%') },
    { label: 'Disputed STEMs', value: metric(kpis.disputedStems) },
    { label: 'Cancelled STEMs', value: metric(kpis.cancelledStems) },
    { label: 'Last activity', value: kpis.lastStemDate || 'Unavailable' },
  ], y);
  if (financialRows.length) {
    y = drawSectionTitle(doc, 'Financial Performance by Currency', y);
    y = drawTable(doc, ['Currency', insight.activeRole === 'supplier' ? 'Allocated Revenue' : 'Turnover', 'Supplier Spend', 'Gross Profit'], financialRows.map((row) => [row.currency, money(row.turnover, row.currency), money(row.supplierSpend, row.currency), money(row.grossProfit, row.currency)]), [28, 54, 50, 50], y);
  }
  y = drawSectionTitle(doc, 'Activity and Profit Trend', y);
  if ((kpis.currencyTrends || []).length) {
    for (const currencyTrend of kpis.currencyTrends) {
      y = ensurePage(doc, y, 52);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(currencyTrend.currency, 16, y);
      y = drawTrend(doc, currencyTrend.rows, y + 3);
    }
  } else {
    y = drawTrend(doc, kpis.trend, y);
  }
  y = drawSectionTitle(doc, 'Payments and Risk', y);
  const paymentRows = insight.activeRole === 'supplier'
    ? (insight.payments?.supplier?.byCurrency || []).map((row) => [row.currency, money(row.invoiceAmount, row.currency), money(row.paidAmount, row.currency), money(row.outstandingPayable, row.currency)])
    : (insight.payments?.buyer?.byCurrency || []).map((row) => [row.currency, money(row.invoiceAmount, row.currency), money(row.paymentsReceived, row.currency), money(row.receivable, row.currency)]);
  y = drawTable(doc, ['Currency', 'Invoiced', insight.activeRole === 'supplier' ? 'Paid' : 'Received', insight.activeRole === 'supplier' ? 'Payable' : 'Receivable'], paymentRows.length ? paymentRows : [['—', 'Unavailable', 'Unavailable', 'Unavailable']], [28, 52, 52, 50], y);
  const dispute = insight.risk?.dispute || {};
  y = drawKpiGrid(doc, [
    { label: 'Open disputes', value: metric(dispute.open) },
    { label: 'Closed disputes', value: metric(dispute.closed) },
    { label: 'Open accounting instructions', value: metric(dispute.openInstructions) },
  ], y);
  y = drawSectionTitle(doc, insight.activeRole === 'group' ? 'Top Children' : 'Top STEMs', y);
  const rows = insight.activeRole === 'group'
    ? (insight.children || []).slice(0, 12).map((row) => [[row.name, row.clKey].filter(Boolean).join(' · '), row.stemCount, money(row.turnover), money(row.grossProfit)])
    : (insight.exportRows || insight.stems?.rows || []).slice(0, 20).map((row) => [row.stemName, row.effectiveDate, metric(row.volumeMt, ' MT'), money(row.turnover, row.currency), money(row.grossProfit, row.currency)]);
  y = drawTable(doc, insight.activeRole === 'group' ? ['Account', 'STEMs', 'Turnover', 'Gross Profit'] : ['STEM', 'Date', 'Volume', 'Turnover', 'Gross Profit'], rows, insight.activeRole === 'group' ? [72, 22, 44, 44] : [47, 27, 30, 39, 39], y);
  y = drawSectionTitle(doc, 'Methodology and Data Warnings', y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(55, 65, 81);
  y = addWrappedText(doc, 'Buyer metrics use the complete STEM result. Supplier metrics allocate direct revenue and cost first, then shared commissions and unassigned costs by direct revenue share, falling back to cost share and equal share. Approximate density conversions are used only for volume statistics.', 16, y, 178);
  for (const warning of insight.warnings || []) {
    y = ensurePage(doc, y + 2, 12);
    y = addWrappedText(doc, `• ${warning}`, 18, y, 174);
  }
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`FCOS Account Insight · Source ${insight.meta?.salesforceFetchedAt || 'Unavailable'}`, 14, 290);
    doc.text(`${page} / ${pageCount}`, 196, 290, { align: 'right' });
  }
  return Buffer.from(doc.output('arraybuffer'));
}

export function generateDashboardAccountInsightExport(insight, { format, actorName, today = hongKongToday() }) {
  const normalizedFormat = text(format).toLowerCase();
  if (normalizedFormat === 'csv') {
    return {
      buffer: Buffer.from(csvRows(insight), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      filename: accountInsightFilename(insight, 'csv', today),
    };
  }
  if (normalizedFormat === 'pdf') {
    return {
      buffer: pdfBuffer(insight, actorName, new Date().toISOString()),
      contentType: 'application/pdf',
      filename: accountInsightFilename(insight, 'pdf', today),
    };
  }
  throw Object.assign(new Error('Choose PDF or CSV export format.'), { status: 400 });
}

export const dashboardAccountInsightExportInternals = { csvCell, accountInsightFilename };
