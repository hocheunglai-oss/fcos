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

const PAGE_BOTTOM = 282;
const CONTENT_X = 14;
const CONTENT_WIDTH = 182;

function addWrappedText(context, value, x, y, width, options = {}) {
  const { doc } = context;
  const lines = doc.splitTextToSize(text(value) || 'Unavailable', width);
  const required = Math.max(6, lines.length * 4.4);
  const nextY = ensurePage(context, y, required);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(55, 65, 81);
  doc.text(lines, x, nextY, options);
  return nextY + required;
}

function drawPageHeader(context, continued = false) {
  const { doc, insight, actor, generatedAt } = context;
  const identity = insight.identity || {};
  doc.setFillColor(15, 55, 88);
  doc.rect(0, 0, 210, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(continued ? 14 : 19);
  doc.text(identity.name || 'Account Insight', CONTENT_X, continued ? 13 : 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text([
    identity.clKey ? `CL Key ${identity.clKey}` : 'CL Key not set',
    `${text(insight.activeRole).toUpperCase()} · ${insight.period?.label || 'Selected period'}${continued ? ' · Continued' : ''}`,
  ], CONTENT_X, 21);
  doc.setFontSize(7.2);
  doc.text(`Generated ${generatedAt} · ${actor || 'FCOS user'}`, CONTENT_X, 30);
}

function ensurePage(context, y, required = 24) {
  if (y + required <= PAGE_BOTTOM) return y;
  context.doc.addPage();
  drawPageHeader(context, true);
  return 44;
}

function drawSectionTitle(context, title, y, subtitle = '') {
  const { doc } = context;
  const required = subtitle ? 18 : 14;
  const nextY = ensurePage(context, y, required);
  doc.setFillColor(239, 246, 255);
  doc.rect(CONTENT_X, nextY - 5, CONTENT_WIDTH, subtitle ? 13 : 9, 'F');
  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(title, CONTENT_X + 3, nextY + 1);
  if (subtitle) {
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text(subtitle, CONTENT_X + 3, nextY + 6);
  }
  doc.setTextColor(31, 41, 55);
  return nextY + (subtitle ? 18 : 10);
}

function drawKpiGrid(context, items, startY) {
  const { doc } = context;
  let y = startY;
  const columns = 3;
  const width = 58;
  const height = 19;
  items.forEach((item, index) => {
    if (index > 0 && index % columns === 0) y += height + 3;
    if (index % columns === 0) y = ensurePage(context, y, height + 4);
    const column = index % columns;
    const x = CONTENT_X + column * (width + 4);
    doc.setDrawColor(214, 220, 229);
    doc.setFillColor(250, 251, 252);
    doc.roundedRect(x, y, width, height, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.4);
    doc.setTextColor(17, 24, 39);
    const valueLines = doc.splitTextToSize(text(item.value), width - 8).slice(0, 2);
    doc.text(valueLines, x + 4, y + 13);
  });
  return y + height + 6;
}

function drawTable(context, headers, rows, widths, startY, { align = [] } = {}) {
  const { doc } = context;
  let y = startY;
  const drawHeader = () => {
    y = ensurePage(context, y, 14);
    doc.setFillColor(30, 64, 175);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    let x = CONTENT_X;
    headers.forEach((header, index) => {
      doc.setFillColor(30, 64, 175);
      doc.rect(x, y, widths[index], 8, 'F');
      doc.setTextColor(255, 255, 255);
      const right = align[index] === 'right';
      doc.text(header, right ? x + widths[index] - 2 : x + 2, y + 5, right ? { align: 'right' } : {});
      x += widths[index];
    });
    y += 8;
  };
  drawHeader();
  rows.forEach((row, rowIndex) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const cells = row.map((cell, index) => doc.splitTextToSize(text(cell) || '—', widths[index] - 4).slice(0, 3));
    const rowHeight = Math.max(9, Math.max(...cells.map((lines) => lines.length)) * 3.6 + 3.5);
    if (y + rowHeight > PAGE_BOTTOM) {
      doc.addPage();
      drawPageHeader(context, true);
      y = 44;
      drawHeader();
    }
    const fill = rowIndex % 2 ? 248 : 255;
    let x = CONTENT_X;
    cells.forEach((lines, index) => {
      doc.setFillColor(fill, fill, fill);
      doc.rect(x, y, widths[index], rowHeight, 'F');
      doc.setTextColor(31, 41, 55);
      const right = align[index] === 'right';
      doc.text(lines, right ? x + widths[index] - 2 : x + 2, y + 4.6, right ? { align: 'right' } : {});
      x += widths[index];
    });
    y += rowHeight;
  });
  return y + 5;
}

function hasMeaningfulPayment(row, role) {
  const keys = role === 'supplier'
    ? ['invoiceAmount', 'paidAmount', 'outstandingPayable']
    : ['invoiceAmount', 'paymentsReceived', 'receivable'];
  return keys.some((key) => Math.abs(number(row?.[key]) || 0) > 0.005);
}

function recentPerformanceRows(kpis, currency) {
  const source = (kpis.currencyTrends || []).find((entry) => entry.currency === currency)?.rows
    || (kpis.currencyTrends || [])[0]?.rows
    || kpis.trend
    || [];
  return source.slice(-12).map((row) => [
    row.period,
    metric(row.stems),
    metric(row.volumeMt, ' MT'),
    money(row.turnover, currency),
    money(row.grossProfit, currency),
    metric(row.grossMarginPct, '%'),
  ]);
}

function topStemRows(insight) {
  return [...(insight.exportRows || insight.stems?.rows || [])]
    .filter((row) => row.stemName)
    .sort((left, right) => Math.abs(number(right.grossProfit) || 0) - Math.abs(number(left.grossProfit) || 0)
      || Math.abs(number(right.turnover) || 0) - Math.abs(number(left.turnover) || 0)
      || text(right.effectiveDate).localeCompare(text(left.effectiveDate)))
    .slice(0, 12)
    .map((row) => [
      row.stemName,
      row.effectiveDate,
      metric(row.volumeMt, ' MT'),
      money(row.turnover, row.currency),
      money(row.grossProfit, row.currency),
      metric(row.grossMarginPct, '%'),
    ]);
}

function pdfBuffer(insight, actor, generatedAt) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: false });
  const context = { doc, insight, actor, generatedAt };
  drawPageHeader(context);
  let y = 45;
  const kpis = insight.kpis || {};
  const financialRows = kpis.moneyByCurrency || [];
  const financialCurrency = financialRows.length === 1 ? financialRows[0].currency : '';
  const financialKpi = (value) => financialRows.length === 1
    ? money(value, financialCurrency)
    : financialRows.length > 1 ? 'Separated in CSV' : 'Unavailable';

  y = drawSectionTitle(context, 'Executive Summary', y, 'Complete selected-period figures; financial values are shown only when one currency is present.');
  y = drawKpiGrid(context, [
    { label: 'STEMs', value: `${metric(kpis.stemCount)} · ${metric(kpis.deliveredStems)} delivered` },
    { label: 'Pending STEMs', value: metric(kpis.pendingStems) },
    { label: 'Volume', value: metric(kpis.totalVolumeMt, ' MT') },
    { label: insight.activeRole === 'supplier' ? 'Allocated revenue' : 'Turnover', value: financialKpi(kpis.turnover) },
    { label: 'Supplier spend', value: financialKpi(kpis.supplierSpend) },
    { label: 'Gross profit', value: financialKpi(kpis.grossProfit) },
    { label: 'Gross margin', value: financialRows.length === 1 ? metric(kpis.grossMarginPct, '%') : 'Separated in CSV' },
    { label: 'Disputed STEMs', value: metric(kpis.disputedStems) },
    { label: 'Last activity', value: kpis.lastStemDate || 'Unavailable' },
  ], y);

  const performanceRows = financialRows.length === 1 ? recentPerformanceRows(kpis, financialCurrency) : [];
  if (performanceRows.length) {
    y = drawSectionTitle(context, 'Recent Performance', y, 'Actual figures replace the former chart; up to 12 most recent periods are shown.');
    y = drawTable(context,
      ['Period', 'STEMs', 'Volume', 'Turnover', 'Gross Profit', 'Margin'],
      performanceRows,
      [25, 20, 28, 38, 38, 33],
      y,
      { align: ['left', 'right', 'right', 'right', 'right', 'right'] },
    );
  }

  const paymentSource = insight.activeRole === 'supplier' ? insight.payments?.supplier : insight.payments?.buyer;
  const meaningfulPayments = (paymentSource?.byCurrency || []).filter((row) => hasMeaningfulPayment(row, insight.activeRole));
  if (meaningfulPayments.length) {
    y = drawSectionTitle(context, insight.activeRole === 'supplier' ? 'Supplier Payments' : 'Buyer Collections', y);
    const paymentRows = insight.activeRole === 'supplier'
      ? meaningfulPayments.map((row) => [row.currency, money(row.invoiceAmount, row.currency), money(row.paidAmount, row.currency), money(row.outstandingPayable, row.currency)])
      : meaningfulPayments.map((row) => [row.currency, money(row.invoiceAmount, row.currency), money(row.paymentsReceived, row.currency), money(row.receivable, row.currency)]);
    y = drawTable(context,
      ['Currency', 'Invoiced', insight.activeRole === 'supplier' ? 'Paid' : 'Received', insight.activeRole === 'supplier' ? 'Payable' : 'Receivable'],
      paymentRows,
      [28, 52, 52, 50],
      y,
      { align: ['left', 'right', 'right', 'right'] },
    );
    const paymentFacts = [
      paymentSource?.paymentCount != null ? `Payments: ${metric(paymentSource.paymentCount)}` : null,
      paymentSource?.weightedDso != null ? `Weighted DSO: ${metric(paymentSource.weightedDso)} days` : null,
      paymentSource?.latestPayment?.paymentDate || paymentSource?.latestPayment?.date
        ? `Latest payment: ${paymentSource.latestPayment.paymentDate || paymentSource.latestPayment.date}`
        : null,
    ].filter(Boolean).join(' · ');
    if (paymentFacts) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.3);
      doc.setTextColor(71, 85, 105);
      y = addWrappedText(context, paymentFacts, CONTENT_X + 2, y, CONTENT_WIDTH - 4);
    }
  }

  const dispute = insight.risk?.dispute || {};
  const exceptions = insight.risk?.exceptions || {};
  const hasRisk = [dispute.open, dispute.closed, dispute.openInstructions, exceptions.count, exceptions.overdue, kpis.disputedStems]
    .some((value) => (number(value) || 0) > 0);
  if (hasRisk) {
    y = drawSectionTitle(context, 'Risk and Exceptions', y);
    y = drawKpiGrid(context, [
      { label: 'Open disputes', value: metric(dispute.open) },
      { label: 'Closed disputes', value: metric(dispute.closed) },
      { label: 'Open instructions', value: metric(dispute.openInstructions) },
      { label: 'Disputed STEMs', value: metric(kpis.disputedStems) },
      { label: 'Exceptions', value: metric(exceptions.count) },
      { label: 'Overdue exceptions', value: metric(exceptions.overdue) },
    ], y);
  }

  if (insight.activeRole === 'group') {
    const groupCurrency = financialRows.length === 1 ? financialCurrency : '';
    const rows = [...(insight.children || [])]
      .filter((row) => row.stemCount > 0)
      .sort((left, right) => Math.abs(number(right.grossProfit) || 0) - Math.abs(number(left.grossProfit) || 0))
      .slice(0, 12)
      .map((row) => [[row.name, row.clKey].filter(Boolean).join(' · '), metric(row.stemCount), metric(row.volumeMt, ' MT'), money(row.turnover, groupCurrency), money(row.grossProfit, groupCurrency)]);
    if (rows.length) {
      y = drawSectionTitle(context, 'Top Trading Accounts', y, 'Ranked by absolute gross-profit impact.');
      y = drawTable(context, ['Account', 'STEMs', 'Volume', 'Turnover', 'Gross Profit'], rows, [58, 20, 29, 38, 37], y, { align: ['left', 'right', 'right', 'right', 'right'] });
    }
  } else {
    const rows = topStemRows(insight);
    if (rows.length) {
      y = drawSectionTitle(context, 'Top STEMs', y, 'Ranked by absolute gross-profit impact; all displayed figures are from the selected Account scope.');
      y = drawTable(context,
        ['STEM', 'Date', 'Volume', 'Turnover', 'Gross Profit', 'Margin'],
        rows,
        [34, 24, 27, 37, 37, 23],
        y,
        { align: ['left', 'left', 'right', 'right', 'right', 'right'] },
      );
    }
  }

  const warnings = insight.warnings || [];
  y = ensurePage(context, y, warnings.length ? 34 : 28);
  y = drawSectionTitle(context, warnings.length ? 'Methodology and Data Warnings' : 'Methodology', y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(55, 65, 81);
  y = addWrappedText(context, 'Buyer metrics use the complete STEM result. Supplier metrics allocate direct revenue and cost first, then shared commissions and unassigned costs by direct revenue share, falling back to cost share and equal share. Approximate density conversions are used only for volume statistics.', CONTENT_X + 2, y, CONTENT_WIDTH - 4);
  for (const warning of warnings) {
    y = ensurePage(context, y + 2, 12);
    y = addWrappedText(context, `• ${warning}`, CONTENT_X + 4, y, CONTENT_WIDTH - 8);
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(CONTENT_X, 286, 196, 286);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`FCOS Account Insight · Salesforce source ${insight.meta?.salesforceFetchedAt || 'Unavailable'}`, CONTENT_X, 291);
    doc.text(`Page ${page} of ${pageCount}`, 196, 291, { align: 'right' });
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

export const dashboardAccountInsightExportInternals = {
  csvCell,
  accountInsightFilename,
  recentPerformanceRows,
  topStemRows,
  hasMeaningfulPayment,
};
