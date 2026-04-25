import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Pencil, Loader2, AlertCircle, ExternalLink, X } from 'lucide-react';
import StemEditModal from './StemEditModal';

const SF_BASE = "https://fratellicosulich.my.salesforce.com";

const fmtDate = (v) => { try { return v ? format(new Date(v), 'dd MMM yyyy') : '—'; } catch { return v; } };
const fmtMoney = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtBool = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';

const SECTIONS = [
  {
    title: 'Overview',
    fields: [
      { key: 'KeyStem__c', label: 'Stem Key' },
      { key: 'Name', label: 'Stem Name' },
      { key: 'Office__c', label: 'Office' },
      { key: 'Year__c', label: 'Year' },
      { key: 'F_STEM_Invoice__c', label: 'Invoice Type' },
      { key: 'PDD_Classification__c', label: 'PDD Classification' },
      { key: 'PO_Voyage_Number__c', label: 'PO / Voyage No.' },
      { key: 'Status__c', label: 'Status' },
      { key: 'Type__c', label: 'Type' },
    ],
  },
  {
    title: 'Vessel & Port',
    fields: [
      { key: '_Vessel_Name', label: 'Vessel' },
      { key: '_Port_Name', label: 'Port' },
      { key: '_Agent_Name', label: 'Agent' },
      { key: 'ETA_Start_Date__c', label: 'ETA Start', fmt: fmtDate },
      { key: 'ETA_End_Date__c', label: 'ETA End', fmt: fmtDate },
      { key: 'ETA_ETB__c', label: 'ETB', fmt: fmtDate },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { key: 'Stem_Date__c', label: 'Stem Date', fmt: fmtDate },
      { key: 'Delivery_Date__c', label: 'Delivery Date', fmt: fmtDate },
      { key: 'Expected_Delivery_Date__c', label: 'Expected Delivery', fmt: fmtDate },
      { key: 'Due_Date__c', label: 'Due Date', fmt: fmtDate },
      { key: 'Buyer_Pay_Term_Date__c', label: 'Buyer Pay Term Date', fmt: fmtDate },
      { key: 'Payment_Date__c', label: 'Payment Date', fmt: fmtDate },
      { key: 'Original_Invoice_Sent_Date__c', label: 'Invoice Sent Date', fmt: fmtDate },
      { key: 'Original_BDN_Sent_Date__c', label: 'BDN Sent Date', fmt: fmtDate },
    ],
  },
  {
    title: 'Financials',
    fields: [
      { key: 'Total_Invoice_Amount__c', label: 'Buyer Invoice Amount', fmt: fmtMoney },
      { key: 'Total_Invoiced_Amount_From_Suppliers__c', label: 'Supplier Invoice Amount', fmt: fmtMoney },
      { key: 'Costs_Total__c', label: 'Total Costs', fmt: fmtMoney },
      { key: 'Invoice_Amount__c', label: 'Invoice Amount', fmt: fmtMoney },
      { key: 'Payment_Amount__c', label: 'Payment Amount', fmt: fmtMoney },
      { key: 'STEM_Line_Item_Total__c', label: 'Line Item Total', fmt: fmtMoney },
      { key: 'Total__c', label: 'Total', fmt: fmtMoney },
      { key: 'Balance__c', label: 'Balance', fmt: fmtMoney },
      { key: 'Actual_Balance__c', label: 'Actual Balance', fmt: fmtMoney },
      { key: 'Overdue__c', label: 'Overdue Amount', fmt: fmtMoney },
      { key: 'Buyer_Paid__c', label: 'Buyer Paid', fmt: fmtMoney },
      { key: 'Total_Difference__c', label: 'Total Difference', fmt: fmtBool },
    ],
  },
  {
    title: 'Dispute',
    fields: [
      { key: 'Dispute__c', label: 'Has Dispute', fmt: fmtBool },
      { key: 'Dispute_Status__c', label: 'Dispute Status' },
      { key: 'Dispute_Type__c', label: 'Dispute Type' },
      { key: 'Dispute_Particular__c', label: 'Dispute Particular' },
    ],
  },
  {
    title: 'Other',
    fields: [
      { key: '_Buyer_Broker_Name', label: 'Buyer Broker' },
      { key: '_Factoring_Invoice_Name', label: 'Factoring Invoice' },
      { key: 'Mailing_Status__c', label: 'Mailing Status' },
      { key: 'Due_Date_Override__c', label: 'Due Date Override', fmt: fmtBool },
      { key: 'CreatedDate', label: 'Created', fmt: fmtDate },
      { key: 'LastModifiedDate', label: 'Last Modified', fmt: fmtDate },
    ],
  },
];

function computePnl(record) {
  const buyer = record.Total_Invoice_Amount__c;
  const supplier = record.Total_Invoiced_Amount_From_Suppliers__c;
  const costs = record.Costs_Total__c ?? 0;
  if (buyer == null || supplier == null) return null;
  return buyer - supplier - costs;
}

export default function StemDetailModal({ stemId, open, onClose, onUpdated }) {
  const [record, setRecord] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [extraCosts, setExtraCosts] = useState([]);
  const [buyerBrokers, setBuyerBrokers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!open || !stemId) return;
    setRecord(null);
    setLineItems([]);
    setExtraCosts([]);
    setBuyerBrokers([]);
    setError(null);
    setLoading(true);
    base44.functions.invoke('salesforceStemDetail', { stemId }).then(res => {
      if (res.data?.error) setError(res.data.error);
      else {
        setRecord(res.data.record);
        setLineItems(res.data.lineItems || []);
        setExtraCosts(res.data.extraCosts || []);
        setBuyerBrokers(res.data.buyerBrokers || []);
      }
      setLoading(false);
    });
  }, [open, stemId]);

  const handleSaved = (updatedRecord) => {
    setRecord(updatedRecord);
    setEditOpen(false);
    onUpdated?.();
  };

  const pnl = record ? computePnl(record) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border sticky top-0 bg-card z-10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Stem Detail</p>
                <DialogTitle className="text-lg font-bold font-dm">
                  {record?.KeyStem__c || record?.Name || stemId}
                </DialogTitle>
                {(record?._Vessel_Name || record?.Vessel__c) && (
                  <p className="text-sm text-muted-foreground mt-0.5">Vessel: {record._Vessel_Name || record.Vessel__c}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {record && (
                  <a
                    href={`${SF_BASE}/${record.Id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Salesforce
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={!record} className="gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
              </div>
            </div>

            {/* P&L summary banner */}
            {pnl != null && (
              <div className={`mt-3 flex items-center gap-6 px-4 py-2.5 rounded-lg text-sm font-medium ${pnl >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                <span>Buyer Invoice: <strong>{fmtMoney(record.Total_Invoice_Amount__c)}</strong></span>
                <span>−</span>
                <span>Supplier Invoice: <strong>{fmtMoney(record.Total_Invoiced_Amount_From_Suppliers__c)}</strong></span>
                <span>−</span>
                <span>Costs: <strong>{fmtMoney(record.Costs_Total__c ?? 0)}</strong></span>
                <span className="ml-auto">P&L: <strong>{fmtMoney(pnl)}</strong></span>
              </div>
            )}

            {record?.Dispute__c && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Disputed — {record.Dispute_Type__c || ''} {record.Dispute_Status__c ? `· ${record.Dispute_Status__c}` : ''}</span>
              </div>
            )}
          </DialogHeader>

          <div className="px-6 py-5">
            {loading && (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading…
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {record && !loading && (
              <div className="space-y-6">
                {SECTIONS.map(section => {
                  const rows = section.fields.filter(f => {
                    const v = record[f.key];
                    return v != null && v !== '' && v !== false;
                  });
                  if (!rows.length) return null;
                  return (
                    <div key={section.title}>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b border-border">
                        {section.title}
                      </h3>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
                        {rows.map(f => {
                          const raw = record[f.key];
                          const display = f.fmt ? f.fmt(raw) : (raw == null ? '—' : String(raw));
                          return (
                            <div key={f.key} className="flex justify-between gap-2 text-sm">
                              <span className="text-muted-foreground shrink-0">{f.label}</span>
                              <span className="text-foreground font-medium text-right">{display}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {record && (
        <StemEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          record={record}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}