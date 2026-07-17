import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';

const asArray = (value) => Array.isArray(value) ? value : [];

function displayDate(value, includeTime = false) {
  if (!value) return '-';
  try { return format(new Date(value), includeTime ? 'dd MMM yyyy HH:mm' : 'dd MMM yyyy'); } catch { return String(value); }
}

function displayQuantity(minimum, maximum, uom) {
  if (minimum == null && maximum == null) return '-';
  const min = Number(minimum ?? maximum);
  const max = Number(maximum ?? minimum);
  const amount = min === max ? min.toLocaleString() : `${min.toLocaleString()}–${max.toLocaleString()}`;
  return `${amount}${uom ? ` ${uom}` : ''}`;
}

function displayMoney(value, currency) {
  if (value == null || value === '') return '-';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return `${currency || 'USD'} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function handoffAlerts(packageData) {
  const trade = packageData?.trade || {};
  const alerts = [];
  if (!asArray(packageData?.allocations).length) alerts.push('No supplier allocation is included.');
  if (!asArray(packageData?.deliveries).length) alerts.push('No delivery or BDN evidence is included.');
  if (!asArray(packageData?.documents).length) alerts.push('No linked document metadata is included.');
  if (trade.riskLevel && !['none', 'low'].includes(String(trade.riskLevel).toLowerCase())) alerts.push(`Trade risk is ${trade.riskLevel}.`);
  if (asArray(trade.riskFlags).length) alerts.push(`${asArray(trade.riskFlags).length} recorded risk flag${asArray(trade.riskFlags).length === 1 ? '' : 's'} require review.`);
  if (asArray(packageData?.openTasks).length) alerts.push(`${asArray(packageData.openTasks).length} open workflow task${asArray(packageData.openTasks).length === 1 ? '' : 's'} remain.`);
  return alerts;
}

export function BackboneFinanceHandoffPanel({ handoffs, loading, error, onOpen }) {
  return (
    <TableShell
      title="Backbone Finance handoffs"
      meta="Immutable comparison packages from trade operations"
      className="mb-6"
      bodyClassName="p-0"
    >
      {loading ? (
        <StateBlock icon={Loader2} title="Checking Backbone handoffs…" description="Loading the Finance packages available to this signed-in user." />
      ) : error ? (
        <StateBlock icon={ShieldCheck} title="Backbone handoffs are unavailable" description={error} />
      ) : !handoffs.length ? (
        <StateBlock icon={ClipboardCheck} title="No Finance handoff is ready" description="When Operations prepares an immutable delivery package, a mapped Backbone Finance or Administrator user can review it here. This does not create an invoice or change FCOS." />
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Trade</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer / vessel</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Delivery window</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Package</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Review</th>
                <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {handoffs.map((handoff) => (
                <tr key={handoff.handoffId} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-3"><div className="font-medium">{handoff.enquiryNumber}</div><div className="mt-0.5 text-muted-foreground">{handoff.officeCode} · {handoff.currency}</div></td>
                  <td className="px-3 py-3"><div className="font-medium">{handoff.buyerName || '-'}</div><div className="mt-0.5 text-muted-foreground">{handoff.vesselName || '-'}{handoff.portName ? ` · ${handoff.portName}` : ''}</div></td>
                  <td className="px-3 py-3 text-muted-foreground">{displayDate(handoff.deliveryFrom)} – {displayDate(handoff.deliveryTo)}</td>
                  <td className="px-3 py-3"><div>Version {handoff.versionNumber}</div><div className="mt-0.5 text-muted-foreground">Prepared {displayDate(handoff.preparedAt, true)}</div></td>
                  <td className="px-3 py-3"><span className={handoff.reviewStatus === 'acknowledged' ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>{handoff.reviewStatus === 'acknowledged' ? 'Acknowledged' : 'Ready for review'}</span>{handoff.fcosReference && <div className="mt-0.5 text-muted-foreground">Reference recorded</div>}</td>
                  <td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => onOpen(handoff)}>Open package</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableShell>
  );
}

function SectionTitle({ icon: Icon, title, meta }) {
  return <div className="mb-3 flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /><div><h3 className="text-sm font-semibold">{title}</h3>{meta && <p className="text-xs text-muted-foreground">{meta}</p>}</div></div>;
}

export function BackboneFinanceHandoffDialog({ selected, detail, loading, error, onOpenChange }) {
  const handoff = detail?.handoff || selected;
  const packageData = detail?.package || {};
  const trade = packageData.trade || {};
  const alerts = handoffAlerts(packageData);
  const allocations = asArray(packageData.allocations);
  const deliveries = asArray(packageData.deliveries);
  const documents = asArray(packageData.documents);
  const awards = asArray(packageData.awards);
  const communications = asArray(packageData.communications);
  const changes = packageData.commercialChanges || {};

  return (
    <Dialog open={Boolean(selected)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Immutable Finance handoff · {handoff?.enquiryNumber || 'Loading'}</DialogTitle>
          <DialogDescription>Comparison evidence from Backbone. Viewing it does not create an invoice, change a payment, send a message, or update Salesforce.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(94vh-154px)] overflow-auto px-5 py-4">
          {loading ? <StateBlock icon={Loader2} title="Opening immutable package…" description="Retrieving the Finance-scoped evidence package." /> : error ? (
            <StateBlock icon={AlertTriangle} title="Package could not be opened" description={error} />
          ) : detail ? (
            <div className="space-y-6">
              <div className="grid gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Buyer</p><p className="mt-1 font-medium">{trade.buyerName || handoff.buyerName || '-'}</p></div>
                <div><p className="text-xs text-muted-foreground">Vessel / port</p><p className="mt-1 font-medium">{trade.vesselName || handoff.vesselName || '-'}{(trade.portName || handoff.portName) ? ` · ${trade.portName || handoff.portName}` : ''}</p></div>
                <div><p className="text-xs text-muted-foreground">Delivery window</p><p className="mt-1 font-medium">{displayDate(trade.deliveryFrom || handoff.deliveryFrom)} – {displayDate(trade.deliveryTo || handoff.deliveryTo)}</p></div>
                <div><p className="text-xs text-muted-foreground">Package status</p><p className={handoff.reviewStatus === 'acknowledged' ? 'mt-1 font-medium text-emerald-700' : 'mt-1 font-medium text-amber-700'}>{handoff.reviewStatus === 'acknowledged' ? 'Acknowledged' : 'Ready for review'}</p></div>
              </div>

              <div className="rounded-xl border p-4">
                <SectionTitle icon={AlertTriangle} title="Finance comparison flags" meta="Automatic prompts from the frozen package; they do not block the existing FCOS workflow." />
                {alerts.length ? <ul className="space-y-2 text-sm">{alerts.map((alert) => <li key={alert} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{alert}</li>)}</ul> : <p className="text-sm text-emerald-700">No package-level exception prompt was found. Finance still compares the package with the live FCOS record before proceeding.</p>}
              </div>

              <div className="rounded-xl border p-4">
                <SectionTitle icon={ClipboardCheck} title="Accepted award and buyer terms" meta={`${awards.length} award${awards.length === 1 ? '' : 's'} frozen at handoff`} />
                {awards.length ? <div className="overflow-auto"><table className="w-full text-xs"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Stem</th><th className="px-2 py-2 text-left">Buyer / broker</th><th className="px-2 py-2 text-left">Buyer terms</th><th className="px-2 py-2 text-left">Delivery</th><th className="px-2 py-2 text-left">Status</th></tr></thead><tbody>{awards.map((award, index) => <tr key={`${award.stemReference || 'award'}-${index}`} className="border-b border-border/50"><td className="px-2 py-2 font-medium">{award.stemReference || '-'}</td><td className="px-2 py-2">{award.buyerName || '-'}{award.brokerName ? ` via ${award.brokerName}` : ''}</td><td className="px-2 py-2">{award.buyerPaymentTerms || '-'}</td><td className="px-2 py-2">{displayDate(award.deliveryFrom)} – {displayDate(award.deliveryTo)}</td><td className="px-2 py-2">{award.snapshotStatus || '-'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No award was captured in this package.</p>}
              </div>

              <div className="rounded-xl border p-4">
                <SectionTitle icon={CheckCircle2} title="Supplier allocations and terms" meta="Frozen commercial quantities and unit values for Finance comparison" />
                {allocations.length ? <div className="overflow-auto"><table className="w-full text-xs"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Stem / product</th><th className="px-2 py-2 text-left">Supplier</th><th className="px-2 py-2 text-left">Supplier terms</th><th className="px-2 py-2 text-right">Quantity</th><th className="px-2 py-2 text-right">Purchase / unit</th><th className="px-2 py-2 text-right">Sale / unit</th><th className="px-2 py-2 text-right">Extra cost</th></tr></thead><tbody>{allocations.map((allocation, index) => <tr key={`${allocation.stemReference || 'allocation'}-${allocation.productName || index}-${index}`} className="border-b border-border/50"><td className="px-2 py-2"><div className="font-medium">{allocation.productName || '-'}</div><div className="text-muted-foreground">{allocation.stemReference || '-'}</div></td><td className="px-2 py-2">{allocation.supplierName || '-'}</td><td className="px-2 py-2">{allocation.supplierPaymentTerms || '-'}</td><td className="px-2 py-2 text-right tabular-nums">{displayQuantity(allocation.quantityMinimum, allocation.quantityMaximum, allocation.uom)}</td><td className="px-2 py-2 text-right tabular-nums">{displayMoney(allocation.purchaseUnitPrice, allocation.currency || handoff.currency)}</td><td className="px-2 py-2 text-right tabular-nums">{displayMoney(allocation.saleUnitPrice, allocation.currency || handoff.currency)}</td><td className="px-2 py-2 text-right tabular-nums">{displayMoney(allocation.baseExtraCostAmount, allocation.currency || handoff.currency)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No supplier allocation was captured in this package.</p>}
              </div>

              <div className="rounded-xl border p-4">
                <SectionTitle icon={FileText} title="Delivery and BDN evidence" meta="Actual quantity and variance evidence supplied by Operations" />
                {deliveries.length ? <div className="overflow-auto"><table className="w-full text-xs"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Stem / product</th><th className="px-2 py-2 text-left">Supplier</th><th className="px-2 py-2 text-left">Delivery status</th><th className="px-2 py-2 text-left">BDN</th><th className="px-2 py-2 text-right">Actual quantity</th><th className="px-2 py-2 text-left">Variance note</th></tr></thead><tbody>{deliveries.map((delivery, index) => <tr key={`${delivery.stemReference || 'delivery'}-${delivery.productName || index}-${index}`} className="border-b border-border/50"><td className="px-2 py-2"><div className="font-medium">{delivery.productName || '-'}</div><div className="text-muted-foreground">{delivery.stemReference || '-'}</div></td><td className="px-2 py-2">{delivery.supplierName || '-'}</td><td className="px-2 py-2">{delivery.status || '-'}</td><td className="px-2 py-2">{delivery.bdnNumber || 'Not numbered'}</td><td className="px-2 py-2 text-right tabular-nums">{displayQuantity(delivery.actualQuantity, delivery.actualQuantity, '')}</td><td className="px-2 py-2">{delivery.varianceReason || '-'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No delivery or BDN evidence was captured in this package.</p>}
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-xl border p-4"><SectionTitle icon={FileText} title="Document metadata" meta={`${documents.length} linked record${documents.length === 1 ? '' : 's'}; files remain in their protected vault`} />{documents.length ? <ul className="space-y-2 text-sm">{documents.slice(0, 20).map((document, index) => <li key={`${document.filename || 'document'}-${index}`} className="rounded-md bg-muted/40 p-2"><div className="font-medium">{document.filename || 'Untitled document'}</div><div className="mt-0.5 text-xs text-muted-foreground">{document.linkedAs || document.recordType || 'Linked evidence'} · {document.mimeType || 'Unknown type'} · {document.byteSize ? `${Number(document.byteSize).toLocaleString()} bytes` : 'Size unavailable'}</div></li>)}</ul> : <p className="text-sm text-muted-foreground">No document metadata was captured in this package.</p>}</div>
                <div className="rounded-xl border p-4"><SectionTitle icon={ClipboardCheck} title="Communications and changes" meta="Recorded evidence only; this view does not send a message" />{communications.length || asArray(changes.priceAmendments).length || asArray(changes.scheduleAmendments).length || asArray(changes.supplierSubstitutions).length ? <ul className="space-y-2 text-sm">{communications.map((communication, index) => <li key={`communication-${index}`} className="rounded-md bg-muted/40 p-2">{communication.purpose || 'Communication'} · {communication.audience || '-'} · {communication.status || '-'}{communication.paymentTerms ? ` · ${communication.paymentTerms}` : ''}</li>)}{asArray(changes.priceAmendments).map((change, index) => <li key={`price-change-${index}`} className="rounded-md bg-muted/40 p-2">Price amendment · {change.productName || '-'} · {change.reason || 'No reason recorded'}</li>)}{asArray(changes.scheduleAmendments).map((change, index) => <li key={`schedule-change-${index}`} className="rounded-md bg-muted/40 p-2">Schedule amendment · {change.reason || 'No reason recorded'}</li>)}{asArray(changes.supplierSubstitutions).map((change, index) => <li key={`supplier-change-${index}`} className="rounded-md bg-muted/40 p-2">Supplier substitution · {change.productName || '-'} · {change.reason || 'No reason recorded'}</li>)}</ul> : <p className="text-sm text-muted-foreground">No communication or commercial-change evidence was captured in this package.</p>}</div>
              </div>

              <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">Prepared {displayDate(handoff.preparedAt, true)} · Package version {handoff.versionNumber} · Integrity digest {String(handoff.snapshotHash || '').slice(0, 16)}… · This is a read-only comparison package. Continue any invoice, payment, email, bank, Drive, or Salesforce work through the existing FCOS workflow until that individual successor workflow is accepted.</div>
            </div>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border px-5 py-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
