import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { endOfQuarter, format } from 'date-fns';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import BrokerFilters from '@/components/brokers/BrokerFilters';
import BrokerRegisterTable from '@/components/brokers/BrokerRegisterTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';
import { numericValue, textValue } from '@/lib/displayValue';
import { readExchangeRateSettings } from '@/lib/exchangeRateSettings';

const fmtMoney = (value) => {
  const number = numericValue(value);
  return `$${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtDate = (value) => {
  if (!value) return '';
  if (typeof value === 'object') return textValue(value, '');
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value, ''); }
};
const fmtUnit = (value) => {
  if (typeof value === 'string') return value;
  const number = numericValue(value);
  return number != null ? `${fmtMoney(number)} / MT` : textValue(value, '');
};
const fmtDelay = (value) => {
  const number = numericValue(value);
  return number != null ? `${number.toLocaleString()} day${Math.abs(number) === 1 ? '' : 's'}` : '';
};
const csvValue = (value) => `"${textValue(value, '').replaceAll('"', '""')}"`;
const escapeHtml = (value) => textValue(value, '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
const xlsLineBreaks = (value) => escapeHtml(value).replace(/\r?\n|; /g, '<br/>');
const ISO_FORMAT = 'yyyy-MM-dd';
const payableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount > 0 ? amount : null;
};
const receivableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount < 0 ? Math.abs(amount) : null;
};
const isoDate = (date) => format(date, ISO_FORMAT);
const parseIsoDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const latestRowDate = (rows) => rows
  .map((row) => row.paymentDateSort || row.paymentDate || row.deliveryDate)
  .filter(Boolean)
  .sort()
  .at(-1);
const lastWorkingDayOfQuarter = (basisDate) => {
  const parsed = parseIsoDate(basisDate) || new Date();
  const date = endOfQuarter(parsed);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() - 1);
  return isoDate(date);
};
const bankBuyRateFrom = (exchangeRate) => {
  const exchangeRateValue = numericValue(exchangeRate?.rate);
  return exchangeRateValue != null ? exchangeRateValue * 0.998 : null;
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export default function BrokerRegister() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedBrokerNames, setSelectedBrokerNames] = useState([]);
  const [selectedHiddenBrokerFlags, setSelectedHiddenBrokerFlags] = useState([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [exchangeRateProvider] = useState(() => readExchangeRateSettings().provider);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [exchangeRateError, setExchangeRateError] = useState(null);

  const loadRows = async () => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceBrokerRegister', { limit: 2000 });
    if (res.data?.error) setError(res.data.error);
    setRows(res.data?.rows || []);
    setLoading(false);
  };

  useEffect(() => { loadRows(); }, []);

  const brokerNames = useMemo(() => {
    const visibleRows = rows.filter(row => {
      const typeMatch = !selectedTypes.length || selectedTypes.includes(row.brokerType);
      const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
      const date = row.paymentDateSort || row.paymentDate || '';
      const fromMatch = !fromDate || date >= fromDate;
      const toMatch = !toDate || date <= toDate;
      return typeMatch && hiddenBrokerMatch && fromMatch && toMatch;
    });
    return [...new Set(visibleRows.map(row => textValue(row.brokerName, '')).filter(Boolean))].sort();
  }, [rows, selectedTypes, selectedHiddenBrokerFlags, fromDate, toDate]);

  const filteredRows = useMemo(() => rows.filter(row => {
    const q = search.trim().toLowerCase();
    const textMatch = !q || [row.stemName, row.brokerName, row.productQuantityLabel]
      .some(value => textValue(value, '').toLowerCase().includes(q));
    const typeMatch = !selectedTypes.length || selectedTypes.includes(row.brokerType);
    const brokerMatch = !selectedBrokerNames.length || selectedBrokerNames.includes(textValue(row.brokerName, ''));
    const hiddenBrokerMatch = !selectedHiddenBrokerFlags.length || selectedHiddenBrokerFlags.some(flag => flag === 'individual' ? row.hiddenBrokerIndividual : row.hiddenBrokerCompany);
    const date = row.paymentDateSort || row.paymentDate || '';
    const fromMatch = !fromDate || date >= fromDate;
    const toMatch = !toDate || date <= toDate;
    return textMatch && typeMatch && brokerMatch && hiddenBrokerMatch && fromMatch && toMatch;
  }), [rows, search, selectedTypes, selectedBrokerNames, selectedHiddenBrokerFlags, fromDate, toDate]);

  const total = filteredRows.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0);
  const exchangeRateTargetDate = useMemo(() => {
    const basisDate = toDate || fromDate || latestRowDate(filteredRows) || isoDate(new Date());
    return lastWorkingDayOfQuarter(basisDate);
  }, [filteredRows, fromDate, toDate]);

  useEffect(() => {
    let cancelled = false;
    const loadExchangeRate = async () => {
      setExchangeRateLoading(true);
      setExchangeRateError(null);
      const res = await appClient.functions.invoke('frankfurterUsdCnyRate', {
        date: exchangeRateTargetDate,
        provider: exchangeRateProvider,
      });
      if (cancelled) return;
      if (res.data?.error) {
        setExchangeRate(null);
        setExchangeRateError(res.data.error);
      } else {
        setExchangeRate(res.data);
      }
      setExchangeRateLoading(false);
    };
    loadExchangeRate();
    return () => { cancelled = true; };
  }, [exchangeRateProvider, exchangeRateTargetDate]);

  const commissionPayableTotal = filteredRows.reduce((sum, row) => sum + Number(payableAmount(row) || 0), 0);
  const commissionReceivableTotal = filteredRows.reduce((sum, row) => sum + Number(receivableAmount(row) || 0), 0);
  const bankBuyRate = bankBuyRateFrom(exchangeRate);
  const exchangeRateSummary = exchangeRate
    ? `Mid-rate ${Number(exchangeRate.rate || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}; bank buy rate ${Number(bankBuyRate || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}; applied rate date ${fmtDate(exchangeRate.date)}`
    : exchangeRateError || 'USD/CNY rate unavailable';
  const filterSummaryRows = [
    ['Search', search.trim() || 'All'],
    ['Broker Type', selectedTypes.length ? selectedTypes.join(', ') : 'All'],
    ['Broker Name', selectedBrokerNames.length ? selectedBrokerNames.join(', ') : 'All'],
    ['Hidden Broker Flags', selectedHiddenBrokerFlags.length ? selectedHiddenBrokerFlags.map(flag => flag === 'individual' ? 'Hidden Broker Individual' : 'Hidden Broker Company').join(', ') : 'All'],
    ['Date Range', `${fromDate || 'Any'} to ${toDate || 'Any'}`],
    ['Rows Exported', filteredRows.length.toLocaleString()],
  ];
  const xlsCell = (value, className = '', attrs = '') => `<td${className ? ` class="${className}"` : ''}${attrs ? ` ${attrs}` : ''}>${value == null ? '' : value}</td>`;
  const xlsTextCell = (value, className = '', attrs = '') => xlsCell(escapeHtml(value), className, attrs);
  const xlsNumberCell = (value, className = 'num') => {
    const number = numericValue(value);
    return xlsCell(number == null ? '' : String(number), className);
  };
  const xlsMoneyCell = (value, className = 'money') => {
    const number = numericValue(value);
    return xlsCell(number == null ? '' : String(number), className);
  };
  const exportXls = () => {
    const generatedAt = format(new Date(), 'dd MMM yyyy HH:mm');
    const methodologyRows = [
      ['Source', exchangeRate?.source || 'Frankfurter API'],
      ['API URL', exchangeRate?.apiUrl || 'https://api.frankfurter.dev/v2/rate/USD/CNY'],
      ['Provider / Rate Type', exchangeRate ? `${exchangeRate.providerLabel} / ${exchangeRate.rateType}` : exchangeRateProvider],
      ['Exchange-rate target date', exchangeRateTargetDate],
      ['Requested rate date', exchangeRate?.requestedDate || exchangeRateTargetDate],
      ['Applied rate date', exchangeRate?.date || 'Unavailable'],
      ['Mid-rate', exchangeRate?.rate != null ? Number(exchangeRate.rate).toFixed(6) : 'Unavailable'],
      ['Bank buy rate methodology', 'Frankfurter USD/CNY API rate is treated as the mid-rate. Bank buy rate is calculated as mid-rate less 0.2%, i.e. mid-rate x 0.998.'],
      ['Target-date methodology', 'The default exchange-rate target is the last working day of the quarter based on the selected To Date, otherwise selected From Date, otherwise the latest payment/delivery date in filtered rows, otherwise today. Weekends are moved back to Friday; public holidays are handled by the API fallback to prior available dates.'],
    ];
    const detailRows = filteredRows.map((row) => `
      <tr>
        ${xlsTextCell(row.stemName, 'text')}
        ${xlsCell(xlsLineBreaks(row.productQuantityLabel || row.productName), 'wrap')}
        ${xlsTextCell(fmtDate(row.deliveryDate), 'date')}
        ${xlsTextCell(row.brokerType, 'text')}
        ${xlsTextCell(row.brokerName, 'text')}
        ${xlsCell(xlsLineBreaks(row.commissionUnitPriceLabel || fmtUnit(row.commissionUnitPrice)), 'wrap right')}
        ${xlsMoneyCell(payableAmount(row), 'money')}
        ${xlsMoneyCell(receivableAmount(row), 'money')}
        ${xlsTextCell(row.paymentDateLabel, 'text')}
        ${xlsTextCell(fmtDate(row.paymentDate), 'date')}
        ${xlsTextCell(row.paymentDelayLabel || (row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : ''), 'right')}
      </tr>
    `).join('');
    const workbookHtml = `<!DOCTYPE html>
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Broker Commission</x:Name><x:WorksheetOptions><x:FreezePanes/><x:FrozenNoSplit/><x:SplitHorizontal>16</x:SplitHorizontal><x:TopRowBottomPane>16</x:TopRowBottomPane><x:ProtectContents>False</x:ProtectContents></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
          body { font-family: Arial, sans-serif; color: #111827; }
          table { border-collapse: collapse; }
          .report { width: 100%; }
          .title { background: #0f172a; color: #ffffff; font-size: 20pt; font-weight: 700; padding: 14px 12px; }
          .subtitle { background: #e2e8f0; color: #334155; font-size: 10pt; padding: 8px 12px; }
          .section { background: #dbeafe; color: #1e3a8a; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
          .header { background: #334155; color: #ffffff; font-weight: 700; border: 1px solid #cbd5e1; }
          td, th { border: 1px solid #cbd5e1; padding: 7px 9px; vertical-align: top; font-size: 10pt; }
          .label { background: #f8fafc; color: #64748b; font-weight: 700; }
          .value { background: #ffffff; color: #111827; }
          .summary-label { background: #ecfdf5; color: #065f46; font-weight: 700; }
          .summary-value { background: #ecfdf5; color: #065f46; font-weight: 700; }
          .method-label { background: #fefce8; color: #854d0e; font-weight: 700; width: 220px; }
          .method-value { background: #fffbeb; color: #1f2937; }
          .money { mso-number-format:"\\0022$\\0022#,##0.00"; text-align: right; white-space: nowrap; }
          .cny { mso-number-format:"\\0022CNY \\0022#,##0.00"; text-align: right; white-space: nowrap; }
          .rate { mso-number-format:"0.000000"; text-align: right; }
          .num { mso-number-format:"#,##0.00"; text-align: right; }
          .date { white-space: nowrap; }
          .right { text-align: right; }
          .text { white-space: nowrap; }
          .wrap { white-space: normal; }
          .detail tr:nth-child(even) td { background: #f8fafc; }
          .note { color: #475569; font-style: italic; }
          col.stem { width: 260px; }
          col.product { width: 260px; }
          col.short { width: 125px; }
          col.type { width: 165px; }
          col.broker { width: 260px; }
          col.moneycol { width: 150px; }
          col.delay { width: 120px; }
        </style>
      </head>
      <body>
        <table class="report">
          <colgroup>
            <col class="stem" />
            <col class="product" />
            <col class="short" />
            <col class="type" />
            <col class="broker" />
            <col class="moneycol" />
            <col class="moneycol" />
            <col class="moneycol" />
            <col class="short" />
            <col class="short" />
            <col class="delay" />
          </colgroup>
          <tr><td class="title" colspan="11">Broker's Commission</td></tr>
          <tr><td class="subtitle" colspan="11">Generated ${escapeHtml(generatedAt)} · ${escapeHtml(filteredRows.length.toLocaleString())} rows · Filtered commission total ${escapeHtml(fmtMoney(total))}</td></tr>
          <tr><td colspan="11"></td></tr>
          <tr><td class="section" colspan="11">Applied Filters</td></tr>
          ${filterSummaryRows.map(([label, value]) => `<tr>${xlsTextCell(label, 'label')}${xlsTextCell(value, 'value', 'colspan="10"')}</tr>`).join('')}
          <tr><td colspan="11"></td></tr>
          <tr><td class="section" colspan="11">Summary</td></tr>
          <tr>${xlsTextCell('Commission Payable', 'summary-label')}${xlsMoneyCell(commissionPayableTotal, 'money summary-value')}${xlsTextCell('Commission Receivable', 'summary-label')}${xlsMoneyCell(commissionReceivableTotal, 'money summary-value')}${xlsTextCell('Net Commission Total', 'summary-label')}${xlsMoneyCell(total, 'money summary-value')}${xlsTextCell('Exchange Rate', 'summary-label')}${xlsTextCell(exchangeRateSummary, 'summary-value', 'colspan="4"')}</tr>
          <tr>${xlsTextCell('Commission Payable in CNY', 'summary-label')}${xlsNumberCell(bankBuyRate != null ? commissionPayableTotal * bankBuyRate : null, 'cny summary-value')}${xlsTextCell('Commission Receivable in CNY', 'summary-label')}${xlsNumberCell(bankBuyRate != null ? commissionReceivableTotal * bankBuyRate : null, 'cny summary-value')}${xlsTextCell('Bank Buy Rate', 'summary-label')}${xlsNumberCell(bankBuyRate, 'rate summary-value')}${xlsTextCell('', 'summary-value', 'colspan="5"')}</tr>
          <tr><td colspan="11"></td></tr>
          <tr><td class="section" colspan="11">Exchange Rate Source and Methodology</td></tr>
          ${methodologyRows.map(([label, value]) => `<tr>${xlsTextCell(label, 'method-label')}${xlsTextCell(value, 'method-value', 'colspan="10"')}</tr>`).join('')}
          <tr><td class="note" colspan="11">All commission amounts are exported from the filtered Broker's Commission rows shown in the application at the time of export.</td></tr>
          <tr><td colspan="11"></td></tr>
          <tr><td class="section" colspan="11">Broker Commission Rows</td></tr>
          <tbody class="detail">
            <tr>
              <th class="header">Stem Name</th>
              <th class="header">Products / Quantity</th>
              <th class="header">Delivery Date</th>
              <th class="header">Broker Type</th>
              <th class="header">Broker Name</th>
              <th class="header">Commission / Unit</th>
              <th class="header">Commission Payable</th>
              <th class="header">Commission Receivable</th>
              <th class="header">Payment Date Label</th>
              <th class="header">Payment Date</th>
              <th class="header">Payment Delay</th>
            </tr>
            ${detailRows || `<tr><td colspan="11">No broker commissions found.</td></tr>`}
          </tbody>
        </table>
      </body>
      </html>`;
    const blob = new Blob([workbookHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    downloadBlob(blob, `brokers-commission-${new Date().toISOString().slice(0, 10)}.xls`);
  };

  const exportCsv = () => {
    const headers = ['Stem Name', 'Products / Quantity', 'Delivery Date', 'Broker Type', 'Broker Name', 'Commission / Unit', 'Commission Payable', 'Commission Receivable', 'Payment Date Label', 'Payment Date', 'Payment Delay'];
    const csvRows = filteredRows.map(row => [
      row.stemName,
      row.productQuantityLabel || row.productName,
      fmtDate(row.deliveryDate),
      row.brokerType,
      row.brokerName,
      fmtUnit(row.commissionUnitPriceLabel || row.commissionUnitPrice),
      payableAmount(row) != null ? fmtMoney(payableAmount(row)) : '',
      receivableAmount(row) != null ? fmtMoney(receivableAmount(row)) : '',
      row.paymentDateLabel,
      fmtDate(row.paymentDate),
      row.paymentDelayLabel || (row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : ''),
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `brokers-commission-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        eyebrow="Salesforce broker commissions"
        title="Broker's Commission"
        description="Review supplier, buyer, and secondary buyer broker commissions with payment timing and hidden broker flags."
        meta={`${filteredRows.length.toLocaleString()} rows · ${fmtMoney(total)} filtered commission total`}
        actions={(
          <>
          <Button variant="outline" onClick={exportXls} disabled={loading || !filteredRows.length} className="gap-2 w-fit">
            <Download className="w-4 h-4" /> Export XLS
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={loading || !filteredRows.length} className="gap-2 w-fit">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2 w-fit">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          </>
        )}
      />

      <BrokerFilters search={search} setSearch={setSearch} selectedTypes={selectedTypes} setSelectedTypes={setSelectedTypes} brokerNames={brokerNames} selectedBrokerNames={selectedBrokerNames} setSelectedBrokerNames={setSelectedBrokerNames} selectedHiddenBrokerFlags={selectedHiddenBrokerFlags} setSelectedHiddenBrokerFlags={setSelectedHiddenBrokerFlags} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap gap-6">
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Rows</div><div className="text-xl font-bold">{filteredRows.length.toLocaleString()}</div></div>
        <div><div className="text-xs text-muted-foreground uppercase tracking-wide">Commission Total</div><div className="text-xl font-bold">{fmtMoney(total)}</div></div>
        <div className="min-w-72 flex-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">USD/CNY Exchange Rate</div>
          <div className="mt-1 text-xs text-muted-foreground">
            API rate is treated as mid-rate. CNY conversion uses bank buy rate: mid-rate less 0.2%.
            {exchangeRateLoading && ' Loading rate...'}
            {exchangeRateError && <span className="text-destructive"> {exchangeRateError}</span>}
            {exchangeRate && !exchangeRateLoading && (
              <span> Mid-rate: {Number(exchangeRate.rate).toLocaleString(undefined, { maximumFractionDigits: 6 })} on {fmtDate(exchangeRate.date)} · {exchangeRate.source} · {exchangeRate.rateType}</span>
            )}
          </div>
        </div>
      </div>

      {loading && <StateBlock icon={Loader2} title="Loading broker commissions..." description="Fetching commissions, payment timing, and broker flags from Salesforce." />}
      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {!loading && !error && (
        <TableShell title="Broker Commission Rows" meta={`${filteredRows.length.toLocaleString()} matching rows`} bodyClassName="p-0">
          <BrokerRegisterTable
            rows={filteredRows}
            onRowClick={setSelectedStemId}
            exchangeRate={exchangeRate}
            exchangeRateLoading={exchangeRateLoading}
            exchangeRateError={exchangeRateError}
          />
        </TableShell>
      )}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
    </div>
  );
}
