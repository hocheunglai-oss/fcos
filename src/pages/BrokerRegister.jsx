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
const escapeXmlText = (value) => escapeHtml(value).replace(/\r?\n/g, '&#10;');
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
const roundCurrency = (value) => {
  const number = numericValue(value);
  return number == null ? null : Math.round((number + Number.EPSILON) * 100) / 100;
};
const spreadsheetText = (value) => textValue(value, '').replace(/; /g, '\n');
const widestLineLength = (value) => spreadsheetText(value).split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
const columnWidth = (values, min = 70, max = 260) => {
  const maxLength = values.reduce((width, value) => Math.max(width, widestLineLength(value)), 0);
  return Math.min(max, Math.max(min, Math.round(maxLength * 6.8 + 18)));
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
  ];
  const workbookCell = (value, styleId = 'Text', mergeAcross = 0) => {
    const mergeAttr = mergeAcross ? ` ss:MergeAcross="${mergeAcross}"` : '';
    return `<Cell ss:StyleID="${styleId}"${mergeAttr}><Data ss:Type="String">${escapeXmlText(value)}</Data></Cell>`;
  };
  const workbookNumberCell = (value, styleId = 'Number') => {
    const number = numericValue(value);
    return number == null
      ? workbookCell('', styleId)
      : `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${number}</Data></Cell>`;
  };
  const workbookCurrencyCell = (value, styleId = 'Currency') => {
    const number = roundCurrency(value);
    return number == null
      ? workbookCell('', styleId)
      : `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${number.toFixed(2)}</Data></Cell>`;
  };
  const workbookRow = (cells) => `<Row ss:AutoFitHeight="1">${cells.join('')}</Row>`;
  const workbookColumns = (widths) => widths
    .map((width) => `<Column ss:AutoFitWidth="1" ss:Width="${width}"/>`)
    .join('');
  const workbookStyles = `<Styles>
      <Style ss:ID="Default" ss:Name="Normal">
        <Alignment ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Color="#111827"/>
      </Style>
      <Style ss:ID="Title">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
        <Font ss:FontName="Arial" ss:Size="20" ss:Bold="1" ss:Color="#FFFFFF"/>
        <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
      </Style>
      <Style ss:ID="Subtitle">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Color="#334155"/>
        <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
      </Style>
      <Style ss:ID="Section">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#1E3A8A"/>
        <Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Header">
        <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
        <Interior ss:Color="#334155" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Label">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#64748B"/>
        <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Text">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top" ss:WrapText="1"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="TextRight">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top" ss:WrapText="1"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryLabel">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="SummaryText">
        <Alignment ss:Horizontal="Left" ss:Vertical="Top" ss:WrapText="1"/>
        <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
        <Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Currency">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
        <NumberFormat ss:Format="&quot;$&quot;#,##0.00"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Cny">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
        <NumberFormat ss:Format="&quot;CNY &quot;#,##0.00"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
      <Style ss:ID="Rate">
        <Alignment ss:Horizontal="Right" ss:Vertical="Top"/>
        <NumberFormat ss:Format="#,##0.000000"/>
        <Borders>
          <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
          <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        </Borders>
      </Style>
    </Styles>`;
  const exportXls = () => {
    const generatedAt = format(new Date(), 'dd MMM yyyy HH:mm');
    const methodologyRows = [
      ['Generated At', generatedAt],
      ['Rows Exported', filteredRows.length.toLocaleString()],
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
    const detailRows = filteredRows.map((row) => ({
      stemName: row.stemName,
      productQuantity: spreadsheetText(row.productQuantityLabel || row.productName),
      deliveryDate: fmtDate(row.deliveryDate),
      brokerType: row.brokerType,
      commissionUnit: spreadsheetText(row.commissionUnitPriceLabel || fmtUnit(row.commissionUnitPrice)),
      commissionPayable: payableAmount(row),
      commissionReceivable: receivableAmount(row),
      paymentDateLabel: row.paymentDateLabel,
      paymentDate: fmtDate(row.paymentDate),
      paymentDelay: row.paymentDelayLabel || (row.brokerType === 'Buyer Broker' || row.brokerType === 'Secondary Buyer Broker' ? fmtDelay(row.paymentDelay) : ''),
    }));
    const detailHeaders = ['Stem Name', 'Products / Quantity', 'Delivery Date', 'Broker Type', 'Commission / Unit', 'Commission Payable', 'Commission Receivable', 'Payment Date Label', 'Payment Date', 'Payment Delay'];
    const brokerColumnValues = [
      ['Broker\'s Commission', detailHeaders[0], ...detailRows.map((row) => row.stemName)],
      [detailHeaders[1], ...detailRows.map((row) => row.productQuantity)],
      [detailHeaders[2], ...detailRows.map((row) => row.deliveryDate)],
      [detailHeaders[3], ...detailRows.map((row) => row.brokerType)],
      [detailHeaders[4], ...detailRows.map((row) => row.commissionUnit)],
      [detailHeaders[5], ...detailRows.map((row) => row.commissionPayable)],
      [detailHeaders[6], ...detailRows.map((row) => row.commissionReceivable)],
      [detailHeaders[7], ...detailRows.map((row) => row.paymentDateLabel)],
      [detailHeaders[8], ...detailRows.map((row) => row.paymentDate)],
      [detailHeaders[9], ...detailRows.map((row) => row.paymentDelay)],
    ];
    const brokerRows = [
      workbookRow([workbookCell('Broker\'s Commission', 'Title', 9)]),
      workbookRow([workbookCell(`Generated ${generatedAt} · ${filteredRows.length.toLocaleString()} rows · Filtered commission total ${fmtMoney(total)}`, 'Subtitle', 9)]),
      workbookRow([workbookCell('Applied Filters', 'Section', 9)]),
      ...filterSummaryRows.map(([label, value]) => workbookRow([workbookCell(label, 'Label'), workbookCell(value, 'Text', 8)])),
      workbookRow([workbookCell('Summary', 'Section', 9)]),
      workbookRow([
        workbookCell('Commission Payable', 'SummaryLabel'),
        workbookCurrencyCell(commissionPayableTotal),
        workbookCell('Commission Receivable', 'SummaryLabel'),
        workbookCurrencyCell(commissionReceivableTotal),
        workbookCell('Net Commission Total', 'SummaryLabel'),
        workbookCurrencyCell(total),
        workbookCell('Exchange Rate', 'SummaryLabel'),
        workbookCell(exchangeRateSummary, 'SummaryText', 2),
      ]),
      workbookRow([
        workbookCell('Commission Payable in CNY', 'SummaryLabel'),
        workbookCurrencyCell(bankBuyRate != null ? commissionPayableTotal * bankBuyRate : null, 'Cny'),
        workbookCell('Commission Receivable in CNY', 'SummaryLabel'),
        workbookCurrencyCell(bankBuyRate != null ? commissionReceivableTotal * bankBuyRate : null, 'Cny'),
        workbookCell('Bank Buy Rate', 'SummaryLabel'),
        workbookNumberCell(bankBuyRate, 'Rate'),
        workbookCell('', 'SummaryText', 3),
      ]),
      workbookRow([workbookCell('Broker Commission Rows', 'Section', 9)]),
      workbookRow(detailHeaders.map((header) => workbookCell(header, 'Header'))),
      ...(detailRows.length
        ? detailRows.map((row) => workbookRow([
          workbookCell(row.stemName),
          workbookCell(row.productQuantity),
          workbookCell(row.deliveryDate),
          workbookCell(row.brokerType),
          workbookCell(row.commissionUnit, 'TextRight'),
          workbookCurrencyCell(row.commissionPayable),
          workbookCurrencyCell(row.commissionReceivable),
          workbookCell(row.paymentDateLabel),
          workbookCell(row.paymentDate),
          workbookCell(row.paymentDelay, 'TextRight'),
        ]))
        : [workbookRow([workbookCell('No broker commissions found.', 'Text', 9)])]),
    ];
    const settingsColumnValues = [
      ['Settings', ...methodologyRows.map(([label]) => label)],
      ['Exchange Rate Source and Methodology', ...methodologyRows.map(([, value]) => value)],
    ];
    const settingsRows = [
      workbookRow([workbookCell('Settings', 'Title', 1)]),
      workbookRow([workbookCell('Exchange Rate Source and Methodology', 'Section', 1)]),
      ...methodologyRows.map(([label, value]) => workbookRow([workbookCell(label, 'Label'), workbookCell(value, 'Text')])),
      workbookRow([workbookCell('Note', 'Label'), workbookCell('All commission amounts are exported from the filtered Broker\'s Commission rows shown in the application at the time of export.', 'Text')]),
    ];
    const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
      <?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:html="http://www.w3.org/TR/REC-html40">
        <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
          <Title>Broker's Commission</Title>
          <Author>Salesforce Analytics Hub</Author>
          <Created>${new Date().toISOString()}</Created>
        </DocumentProperties>
        ${workbookStyles}
        <Worksheet ss:Name="Broker Commission">
          <Table ss:ExpandedColumnCount="10" ss:ExpandedRowCount="${brokerRows.length}" x:FullColumns="1" x:FullRows="1">
            ${workbookColumns(brokerColumnValues.map((values, index) => columnWidth(values, index <= 1 ? 110 : 85, index <= 1 ? 280 : 180)))}
            ${brokerRows.join('')}
          </Table>
          <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
            <FreezePanes/>
            <FrozenNoSplit/>
            <SplitHorizontal>10</SplitHorizontal>
            <TopRowBottomPane>10</TopRowBottomPane>
          </WorksheetOptions>
        </Worksheet>
        <Worksheet ss:Name="Settings">
          <Table ss:ExpandedColumnCount="2" ss:ExpandedRowCount="${settingsRows.length}" x:FullColumns="1" x:FullRows="1">
            ${workbookColumns(settingsColumnValues.map((values, index) => columnWidth(values, index === 0 ? 150 : 260, index === 0 ? 260 : 620)))}
            ${settingsRows.join('')}
          </Table>
        </Worksheet>
      </Workbook>`;
    const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
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
