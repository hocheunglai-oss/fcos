import { Fragment } from 'react';
import { format } from 'date-fns';
import { BrokerTypeBadge } from './BrokerBadges';
import { numericValue, textValue } from '@/lib/displayValue';

const fmtDate = (value) => {
  if (!value) return '—';
  if (typeof value === 'object') return textValue(value);
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value); }
};
const fmtMoney = (value) => {
  const number = numericValue(value);
  return `$${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtCny = (value) => {
  const number = numericValue(value);
  return `CNY ${Number(number || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtUnit = (value) => {
  if (typeof value === 'string') return value;
  const number = numericValue(value);
  return number != null ? `${fmtMoney(number)} / MT` : textValue(value);
};
const fmtDelay = (value) => {
  const number = numericValue(value);
  return number != null ? `${number.toLocaleString()} day${Math.abs(number) === 1 ? '' : 's'}` : '—';
};
const payableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount > 0 ? amount : null;
};
const receivableAmount = (row) => {
  const amount = Number(row.commissionAmount || 0);
  return amount < 0 ? Math.abs(amount) : null;
};
const brokerTypeLabel = (value) => value === 'Secondary Buyer Broker' ? 'Buyer Broker' : textValue(value);
const brokerNameValue = (row) => textValue(row?.brokerName, 'Unknown Broker');
const rowIdValue = (row) => textValue(row?.id, '');
const productQuantityLabel = (item) => {
  if (item.label) return item.label;
  const product = textValue(item.productFamily || item.productName, '—');
  const qty = numericValue(item.quantity);
  return qty != null
    ? `${product} - ${qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${item.quantityUnit || 'MT'}`
    : product;
};

function ProductQuantityCell({ row }) {
  const items = row.productQuantities?.length
    ? row.productQuantities
    : row.productQuantityLabel
      ? row.productQuantityLabel.split('; ').map((label) => ({ label }))
      : [{ productFamily: row.productFamily, productName: row.productName, quantity: row.bdnQuantity, quantityUnit: row.quantityUnit }];

  return (
    <div className="min-w-56 space-y-1">
      {items.map((item, index) => (
        <div key={`${item.productFamily || item.productName || item.label}-${index}`} className="text-muted-foreground">
          {productQuantityLabel(item)}
        </div>
      ))}
    </div>
  );
}

function CommissionUnitCell({ row }) {
  const items = row.commissionUnitPriceLines?.length
    ? row.commissionUnitPriceLines
    : row.commissionUnitPriceLabel
      ? row.commissionUnitPriceLabel.split('; ').map((label) => ({ label }))
      : [{ label: fmtUnit(row.commissionUnitPrice) }];

  return (
    <div className="space-y-1 text-right">
      {items.map((item, index) => (
        <div key={`${item.productName || item.label}-${index}`} className="text-foreground">
          {item.label || fmtUnit(item.value)}
        </div>
      ))}
    </div>
  );
}

function SortHeader({ children, priority, align = 'left' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      {priority && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold text-primary">
          {priority}
        </span>
      )}
      <span>{children}</span>
    </span>
  );
}

function brokerSectionsFrom(rows) {
  const sections = [];
  for (const row of rows) {
    const brokerName = brokerNameValue(row);
    const current = sections.at(-1);
    if (current && current.brokerName === brokerName) {
      current.rows.push(row);
    } else {
      sections.push({ brokerName, rows: [row] });
    }
  }
  return sections;
}

export default function BrokerRegisterTable({
  rows,
  onRowClick,
  exchangeRate,
  exchangeRateLoading,
  exchangeRateError,
  showCny = false,
  sortPriority = {},
  excludedRowIds = new Set(),
  onToggleExcluded,
}) {
  const isExcluded = (row) => excludedRowIds.has(rowIdValue(row));
  const includedRows = rows.filter((row) => !isExcluded(row));
  const payableTotal = includedRows.reduce((sum, row) => sum + Number(payableAmount(row) || 0), 0);
  const receivableTotal = includedRows.reduce((sum, row) => sum + Number(receivableAmount(row) || 0), 0);
  const brokerSections = brokerSectionsFrom(rows);
  const exchangeRateValue = numericValue(exchangeRate?.rate);
  const bankBuyRate = exchangeRateValue != null ? exchangeRateValue * 0.998 : null;
  const exchangeRateLabel = exchangeRate
    ? `Mid-rate ${Number(exchangeRateValue || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} · bank buy rate ${Number(bankBuyRate || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} after 0.2% deduction · ${fmtDate(exchangeRate.date)} · ${exchangeRate.providerLabel}`
    : exchangeRateError
      ? `USD/CNY conversion unavailable: ${exchangeRateError}`
      : 'USD/CNY rate loading';

  return (
    <div className="overflow-hidden">
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Include</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground"><SortHeader priority={sortPriority.stemName}>Stem Name</SortHeader></th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Products / Quantity</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground"><SortHeader priority={sortPriority.deliveryDate}>Delivery Date</SortHeader></th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground"><SortHeader priority={sortPriority.brokerType}>Broker Type</SortHeader></th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground"><SortHeader priority={sortPriority.brokerName}>Broker Name</SortHeader></th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Commission / Unit</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Commission Payable</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Commission Receivable</th>
              <th className="sticky top-0 z-10 bg-card text-left py-3 px-4 font-semibold text-muted-foreground">Payment Date</th>
              <th className="sticky top-0 z-10 bg-card text-right py-3 px-4 font-semibold text-muted-foreground">Payment Delay</th>
            </tr>
          </thead>
          <tbody>
            {brokerSections.map((section, sectionIndex) => {
              const includedSectionRows = section.rows.filter((row) => !isExcluded(row));
              const sectionPayable = includedSectionRows.reduce((sum, row) => sum + Number(payableAmount(row) || 0), 0);
              const sectionReceivable = includedSectionRows.reduce((sum, row) => sum + Number(receivableAmount(row) || 0), 0);
              const rowOffset = brokerSections.slice(0, sectionIndex).reduce((sum, item) => sum + item.rows.length, 0);
              return (
                <Fragment key={`section-${section.brokerName}-${sectionIndex}`}>
                  {section.rows.map((row, idx) => {
                    const excluded = isExcluded(row);
                    return (
                    <tr key={row.id} onClick={() => onRowClick(row.stemId)} className={`border-b border-border/40 cursor-pointer transition-colors ${excluded ? 'bg-slate-100/70 text-muted-foreground opacity-70 hover:bg-slate-100' : `hover:bg-muted/30 ${(rowOffset + idx) % 2 ? 'bg-muted/10' : ''}`}`}>
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={!excluded}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => onToggleExcluded?.(row.id)}
                          aria-label={`${excluded ? 'Include' : 'Exclude'} ${row.stemName || 'broker commission row'} in totals and export`}
                          className="h-4 w-4 rounded border-border"
                        />
                      </td>
                      <td className="py-3 px-4 font-medium text-foreground whitespace-nowrap">
                        <div>{textValue(row.stemName)}</div>
                        {excluded && <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Excluded from totals/export</div>}
                      </td>
                      <td className="py-3 px-4"><ProductQuantityCell row={row} /></td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{fmtDate(row.deliveryDate)}</td>
                      <td className="py-3 px-4 whitespace-nowrap"><BrokerTypeBadge type={brokerTypeLabel(row.brokerType)} /></td>
                      <td className="py-3 px-4 text-foreground">{textValue(row.brokerName)}</td>
                      <td className="py-3 px-4 whitespace-nowrap"><CommissionUnitCell row={row} /></td>
                      <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">{payableAmount(row) != null ? fmtMoney(payableAmount(row)) : '—'}</td>
                      <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">{receivableAmount(row) != null ? fmtMoney(receivableAmount(row)) : '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap"><span className="block text-[11px] uppercase tracking-wide">{row.paymentDateLabel}</span>{fmtDate(row.paymentDate)}</td>
                      <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{row.paymentDelayLabel || (brokerTypeLabel(row.brokerType) === 'Buyer Broker' ? fmtDelay(row.paymentDelay) : '—')}</td>
                    </tr>
                    );
                  })}
                  <tr key={`summary-${section.brokerName}`} className="border-b border-border bg-emerald-50/70 font-semibold text-emerald-950">
                    <td colSpan="7" className="py-2.5 px-4 text-right">Broker Summary - {section.brokerName}</td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">{fmtMoney(sectionPayable)}</td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">{fmtMoney(sectionReceivable)}</td>
                    <td colSpan="2" className="py-2.5 px-4" />
                  </tr>
                  {showCny && (
                    <tr key={`summary-cny-${section.brokerName}`} className="border-b border-border bg-emerald-50/40 text-emerald-950">
                      <td colSpan="7" className="py-2.5 px-4 text-right">
                        <div className="font-semibold">Broker Summary in CNY - {section.brokerName}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold whitespace-nowrap">{bankBuyRate != null ? fmtCny(sectionPayable * bankBuyRate) : '—'}</td>
                      <td className="py-2.5 px-4 text-right font-semibold whitespace-nowrap">{bankBuyRate != null ? fmtCny(sectionReceivable * bankBuyRate) : '—'}</td>
                      <td colSpan="2" className="py-2.5 px-4" />
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan="11" className="py-12 text-center text-muted-foreground">No broker commissions found.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50 font-bold">
                <td colSpan="7" className="py-3 px-4 text-right text-foreground">Summary</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtMoney(payableTotal)}</td>
                <td className="py-3 px-4 text-right text-foreground whitespace-nowrap">{fmtMoney(receivableTotal)}</td>
                <td colSpan="2" className="py-3 px-4" />
              </tr>
              {showCny && (
                <tr className="border-t border-border bg-muted/30">
                  <td colSpan="7" className="py-3 px-4 text-right text-foreground">
                    <div className="font-semibold">Summary in CNY using Bank Buy Rate</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {exchangeRateLoading ? 'Loading USD/CNY exchange rate...' : exchangeRateLabel}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">
                    {bankBuyRate != null ? fmtCny(payableTotal * bankBuyRate) : '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-semibold text-foreground whitespace-nowrap">
                    {bankBuyRate != null ? fmtCny(receivableTotal * bankBuyRate) : '—'}
                  </td>
                  <td colSpan="2" className="py-3 px-4" />
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
