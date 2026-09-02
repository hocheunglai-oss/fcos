import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export default function PaymentCollectionThresholdsDialog({
  open,
  onOpenChange,
  drafts,
  onDraftsChange,
  canManage,
  saving,
  onSave,
}) {
  const updateDraft = (index, patch) => {
    onDraftsChange(drafts.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment Collection Thresholds</DialogTitle>
          <DialogDescription>Configure the maximum open receivable balance separately for each ISO currency.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[82px_minmax(0,1fr)_36px] gap-2 text-xs font-medium text-muted-foreground sm:grid-cols-[110px_minmax(0,1fr)_36px]">
            <span>Currency</span>
            <span>Fully paid at or below</span>
            <span />
          </div>
          {drafts.map((item, index) => (
            <div key={`${item.currencyIsoCode || 'new'}-${index}`} className="grid grid-cols-[82px_minmax(0,1fr)_36px] gap-2 sm:grid-cols-[110px_minmax(0,1fr)_36px]">
              <Input
                value={item.currencyIsoCode}
                maxLength={3}
                className="min-w-0 uppercase"
                disabled={!canManage || Number(item.revision || 0) > 0}
                onChange={(event) => updateDraft(index, { currencyIsoCode: event.target.value.toUpperCase() })}
              />
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={item.threshold}
                className="min-w-0"
                disabled={!canManage}
                onChange={(event) => updateDraft(index, { threshold: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove unsaved row"
                disabled={!canManage || Number(item.revision || 0) > 0}
                onClick={() => onDraftsChange(drafts.filter((_, rowIndex) => rowIndex !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {canManage && (
            <Button type="button" variant="outline" size="sm" onClick={() => onDraftsChange([...drafts, { currencyIsoCode: '', threshold: '0', revision: 0 }])}>
              <Plus className="mr-2 h-4 w-4" />
              Add Currency
            </Button>
          )}
          <p className="text-xs text-muted-foreground">An unconfigured currency closes only when the live Salesforce balance is below 0.005. Overpayments also qualify for closure.</p>
          {!canManage && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Finance, Administrators, and the General Manager can change these settings.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={!canManage || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
