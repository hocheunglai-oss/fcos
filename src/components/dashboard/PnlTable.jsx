import { format } from 'date-fns';

const BUYER_FIELD = 'Total_Invoice_Amount__c';
const SUPPLIER_FIELD = 'Total_Invoiced_Amount_From_Suppliers__c';
const DELIVERY_FIELD = 'Delivery_Date__c';

const fmtMoney = (val) => {
  if (val == null) return '—';
  return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtVal = (key, val) => {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (key.toLowerCase().includes('amount') || key.toLowerCase().includes('invoice') || key.toLowerCase().includes('price')) {
    const n = Number(val);
    if (!isNaN(n)) return fmtMoney(n);
  }
  if (key.toLowerCase().includes('date')) {
    try { return format(new Date(val), 'dd MMM yyyy'); } catch { return val; }
  }
  if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const s = String(val);
  return s.length > 50 ? s.slice(0, 48) + '…' : s;
};

const colLabel = (key) =>
  key.replace(/__c$/i, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();

export default function PnlTable({ records = [] }) {
  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  // Determine columns from actual data, exclude Id
  const allCols = Object.keys(records[0]).filter(k => k !== 'Id');

  // Separate P&L special columns so we can inject computed P&L after supplier col
  const hasBuyer = allCols.includes(BUYER_FIELD);
  const hasSupplier = allCols.includes(SUPPLIER_FIELD);
  const showPnl = hasBuyer && hasSupplier;

  // Build column display order: regular cols + inject P&L after supplier if both present
  const displayCols = [];
  allCols.forEach(col => {
    displayCols.push(col);
    if (col === SUPPLIER_FIELD && showPnl) {
      displayCols.push('__pnl__');
    }
  });
  // If buyer present but supplier not last, still append P&L at end
  if (showPnl && !displayCols.includes('__pnl__')) {
    displayCols.push('__pnl__');
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {displayCols.map(col => (
              <th
                key={col}
                className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${
                  col === '__pnl__' || col === BUYER_FIELD || col === SUPPLIER_FIELD ? 'text-right' : 'text-left'
                }`}
              >
                {col === '__pnl__' ? 'P&L' : colLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => {
            const buyer = row[BUYER_FIELD] ?? null;
            const supplier = row[SUPPLIER_FIELD] ?? null;
            const hasDelivery = !!row[DELIVERY_FIELD];
            const pnl = showPnl && hasDelivery && buyer != null && supplier != null ? buyer - supplier : null;
            const pnlPositive = pnl != null && pnl >= 0;

            return (
              <tr key={row.Id || i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                {displayCols.map(col => {
                  if (col === '__pnl__') {
                    return (
                      <td key="__pnl__" className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                        pnl == null ? 'text-muted-foreground' : pnlPositive ? 'text-emerald-600' : 'text-red-500'
                      }`}>
                        {pnl == null ? (showPnl && !hasDelivery ? <span className="text-muted-foreground/50 text-xs">no delivery</span> : '—') : fmtMoney(pnl)}
                      </td>
                    );
                  }
                  const isNumericCol = col === BUYER_FIELD || col === SUPPLIER_FIELD;
                  return (
                    <td key={col} className={`py-2.5 px-3 whitespace-nowrap ${isNumericCol ? 'text-right text-foreground' : 'text-foreground'}`}>
                      {fmtVal(col, row[col])}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}