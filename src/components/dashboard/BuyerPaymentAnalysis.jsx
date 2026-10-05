const percent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const days = (value) => value == null ? '—' : `${Number(value).toFixed(1)} days`;

export default function BuyerPaymentAnalysis({ result, periodLabel, onAccountClick }) {
  const buyers = result?.buyers || [];
  const exclusions = Object.entries(result?.exclusions || {}).filter(([, count]) => Number(count) > 0);
  return <section aria-label="Buyer early payment analysis" className="rounded-xl border border-border bg-card p-5">
    <h2 className="text-base font-semibold">Buyers who usually pay before due</h2>
    <p className="mt-1 text-sm text-muted-foreground">Invoices created at least 7 calendar days before their due date. {periodLabel} · Dashboard delivery period · Payment history reliable from 1 January 2026.</p>
    <p className="mt-2 text-xs text-muted-foreground">Usually means more than 50% of at least 3 eligible invoices were fully paid strictly before due. Partial payments do not count as full payment. Unpaid invoices already due count in the rate; unpaid invoices not yet due are excluded. Creation uses Salesforce CreatedDate in Hong Kong time.</p>
    {!buyers.length ? <p className="mt-5 text-sm">No buyers have eligible, reconciled invoice and payment evidence in this period.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 pr-4">Buyer</th><th className="py-2 pr-4">Currency</th><th className="py-2 pr-4">Eligible invoices</th><th className="py-2 pr-4">Fully paid early</th><th className="py-2 pr-4">Early payment rate</th><th className="py-2 pr-4">Typical days before due</th><th className="py-2">Pattern</th></tr></thead><tbody>
      {buyers.map((buyer) => <tr key={`${buyer.accountId}:${buyer.currency}`} className="border-b last:border-0"><td className="py-3 pr-4"><button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => onAccountClick?.({ accountId: buyer.accountId, name: buyer.name, role: 'buyer' })}>{buyer.name}</button></td><td className="py-3 pr-4">{buyer.currency}</td><td className="py-3 pr-4">{buyer.invoiceCount}</td><td className="py-3 pr-4">{buyer.earlyPaidCount}</td><td className="py-3 pr-4">{percent(buyer.earlyPaymentRate)}</td><td className="py-3 pr-4">{days(buyer.medianDaysPaidBeforeDue)}</td><td className="py-3">{buyer.invoiceCount < 3 ? 'Insufficient history' : buyer.usuallyPaysEarly ? 'Usually pays early' : 'No usual early-payment pattern'}</td></tr>)}
    </tbody></table></div>}
    <p className="mt-3 text-xs text-muted-foreground">Typical days is the median for fully paid eligible invoices: positive means early, zero means on due, negative means late. These historical observations do not establish that earlier invoice creation caused earlier payment.</p>
    {exclusions.length ? <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Excluded evidence</summary><ul className="mt-2 list-disc space-y-1 pl-5">{exclusions.map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ')}: {count}</li>)}</ul></details> : null}
  </section>;
}
