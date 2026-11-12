const percent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const days = (value) => value == null ? '—' : `${Number(value).toFixed(1)} days`;
const columns = ['Buyer', 'Currency', 'Eligible invoices', 'Fully paid early', 'Early payment rate', 'Typical days before due', 'Pattern'];

export default function BuyerPaymentAnalysis({ result, periodLabel, onAccountClick }) {
  const buyers = result?.buyers || [];
  const exclusions = Object.entries(result?.exclusions || {}).filter(([, count]) => Number(count) > 0);
  return <section aria-label="Buyer early payment analysis" className="rounded-xl border border-border bg-card p-5">
    <h2 className="text-base font-semibold">Buyers who usually pay before due</h2>
    <p className="mt-1 text-sm text-muted-foreground">Invoices created at least 7 calendar days before due. {periodLabel} · Dashboard delivery period · Reliable history from 1 January 2026.</p>
    <p className="mt-2 text-xs text-muted-foreground">Usually: over 50% of at least 3 eligible invoices were fully paid strictly before due. Partial payments do not qualify. Due unpaid invoices count; future unpaid invoices are excluded. Creation: Salesforce CreatedDate in Hong Kong time.</p>
    {!buyers.length ? <p className="mt-5 text-sm">No buyers have eligible, reconciled evidence in this period.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm [&_th]:py-2 [&_td]:py-3 [&_th]:pr-4 [&_td]:pr-4"><thead><tr className="border-b text-xs text-muted-foreground">{columns.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {buyers.map((buyer) => <tr key={`${buyer.accountId}:${buyer.currency}`} className="border-b last:border-0"><td><button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => onAccountClick?.({ accountId: buyer.accountId, name: buyer.name, role: 'buyer' })}>{buyer.name}</button></td>{[buyer.currency, buyer.invoiceCount, buyer.earlyPaidCount, percent(buyer.earlyPaymentRate), days(buyer.medianDaysPaidBeforeDue), buyer.invoiceCount < 3 ? 'Insufficient history' : buyer.usuallyPaysEarly ? 'Usually pays early' : 'No usual early-payment pattern'].map((value, index) => <td key={index}>{value}</td>)}</tr>)}
    </tbody></table></div>}
    <p className="mt-3 text-xs text-muted-foreground">Typical days: median for fully paid invoices; positive is early, zero on due, negative late. History does not prove earlier creation caused earlier payment.</p>
    {exclusions.length ? <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Excluded evidence</summary><ul className="mt-2 list-disc space-y-1 pl-5">{exclusions.map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ')}: {count}</li>)}</ul></details> : null}
  </section>;
}
