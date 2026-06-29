import { useState } from 'react';
import { appClient } from '@/api/appClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';

const DISPUTE_STATUS_OPTIONS = [
  'No Dispute',
  'Opened',
  'Closed with Supplier only',
  'Closed with Buyer only',
  'Closed',
];

// Fields that are editable
const EDITABLE_FIELDS = [
  { key: 'Vessel__c', label: 'Vessel', type: 'text' },
  { key: 'Port__c', label: 'Port', type: 'text' },
  { key: 'Delivery_Date__c', label: 'Delivery Date', type: 'date' },
  { key: 'Expected_Delivery_Date__c', label: 'Expected Delivery Date', type: 'date' },
  { key: 'Stem_Date__c', label: 'Stem Date', type: 'date' },
  { key: 'Due_Date__c', label: 'Due Date', type: 'date' },
  { key: 'Payment_Date__c', label: 'Payment Date', type: 'date' },
  { key: 'Buyer_Pay_Term_Date__c', label: 'Buyer Pay Term Date', type: 'date' },
  { key: 'PO_Voyage_Number__c', label: 'PO / Voyage Number', type: 'text' },
  { key: 'PDD_Classification__c', label: 'PDD Classification', type: 'text' },
  { key: 'Office__c', label: 'Office', type: 'text' },
  { key: 'Mailing_Status__c', label: 'Mailing Status', type: 'text' },
  { key: 'Dispute_Particular__c', label: 'Dispute Particular', type: 'text' },
  { key: 'Dispute_Type__c', label: 'Dispute Type', type: 'text' },
  { key: 'Dispute_Status__c', label: 'Dispute Status', type: 'text' },
];

export default function StemEditModal({ open, onClose, record, onSaved }) {
  const [form, setForm] = useState(() => {
    const init = {};
    EDITABLE_FIELDS.forEach(f => { init[f.key] = record[f.key] ?? ''; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    // Only send changed, non-empty fields
    const updates = {};
    EDITABLE_FIELDS.forEach(f => {
      const orig = record[f.key] ?? '';
      const cur = form[f.key] ?? '';
      if (String(cur) !== String(orig)) {
        updates[f.key] = cur === '' ? null : cur;
      }
    });

    const res = await appClient.functions.invoke('salesforceStemDetail', { stemId: record.Id, updates });
    if (res.data?.error) {
      setError(res.data.error);
      setSaving(false);
    } else {
      setSaving(false);
      onSaved(res.data.record);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Stem — {record?.KeyStem__c || record?.Name}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 py-2">
          {EDITABLE_FIELDS.map(f => (
            <div key={f.key}>
              <Label className="text-xs text-muted-foreground mb-1 block">{f.label}</Label>
              {f.key === 'Dispute_Status__c' ? (
                <Select value={form[f.key] || '__blank__'} onValueChange={value => handleChange(f.key, value === '__blank__' ? '' : value)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__blank__">Blank</SelectItem>
                    {DISPUTE_STATUS_OPTIONS.map(status => (
                      <SelectItem key={status} value={status}>{status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type}
                  value={form[f.key] ?? ''}
                  onChange={e => handleChange(f.key, e.target.value)}
                  className="h-8 text-sm"
                />
              )}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
