import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Palette, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ACCOUNT_PIC_ROW_COLOR_MAX_RULES,
  ACCOUNT_PIC_ROW_COLOR_PALETTE,
  accountPicRowColorOptions,
  initialAccountPicRowColorRules,
  normalizeAccountPicRowColorRules,
} from '@/lib/accountPicRowColors';

const createId = () => globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Date.now().toString().padStart(12, '0').slice(-12)}`;

function optionsForRule(rule, columns, rows) {
  const column = columns.find((item) => item.id === rule.columnId);
  const options = accountPicRowColorOptions(column, rows);
  if (rule.matchValue && !options.some((option) => option.value === rule.matchValue)) {
    options.unshift({ value: rule.matchValue, label: `${rule.matchLabel || 'Previous value'} · not currently used` });
  }
  return options;
}

function firstUsefulOption(column, rows) {
  const options = accountPicRowColorOptions(column, rows);
  return options.find((option) => option.value !== 'empty') || options[0];
}

function defaultRule(columns, rows) {
  const column = columns[0];
  const option = firstUsefulOption(column, rows);
  return {
    id: createId(),
    columnId: column.id,
    matchValue: option.value,
    matchLabel: option.label,
    color: ACCOUNT_PIC_ROW_COLOR_PALETTE[0].key,
  };
}

export default function BuyerPicRowColorsDialog({ open, onOpenChange, columns = [], rows = [], rules = [], saving = false, onSave }) {
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeAccountPicRowColorRules(rules, columns);
    setDraft(normalized.length ? normalized : initialAccountPicRowColorRules(columns, rows, createId));
  }, [columns, open, rows, rules]);

  const error = useMemo(() => {
    try {
      normalizeAccountPicRowColorRules(draft, columns, { strict: true });
      return '';
    } catch (validationError) {
      return validationError.message;
    }
  }, [columns, draft]);

  const updateRule = (index, change) => setDraft((current) => current.map((rule, ruleIndex) => {
    if (ruleIndex !== index) return rule;
    const next = { ...rule, ...change };
    if (change.columnId) {
      const column = columns.find((item) => item.id === change.columnId);
      const option = firstUsefulOption(column, rows);
      next.matchValue = option.value;
      next.matchLabel = option.label;
    }
    if (change.matchValue) {
      next.matchLabel = optionsForRule(next, columns, rows).find((option) => option.value === change.matchValue)?.label || next.matchLabel;
    }
    return next;
  }));

  const moveRule = (index, direction) => setDraft((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = current.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Row colours</DialogTitle>
          <DialogDescription>Colour a row when any selected column exactly matches a value. The first matching rule wins.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {draft.map((rule, index) => {
            const valueOptions = optionsForRule(rule, columns, rows);
            return (
              <article key={rule.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_11rem_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor={`row-colour-column-${rule.id}`}>Column</Label>
                  <Select value={rule.columnId} onValueChange={(columnId) => updateRule(index, { columnId })} disabled={saving}>
                    <SelectTrigger id={`row-colour-column-${rule.id}`} aria-label={`Rule ${index + 1} column`}><SelectValue /></SelectTrigger>
                    <SelectContent>{columns.map((column) => <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`row-colour-value-${rule.id}`}>Equals</Label>
                  <Select value={rule.matchValue} onValueChange={(matchValue) => updateRule(index, { matchValue })} disabled={saving}>
                    <SelectTrigger id={`row-colour-value-${rule.id}`} aria-label={`Rule ${index + 1} exact value`}><SelectValue /></SelectTrigger>
                    <SelectContent>{valueOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`row-colour-palette-${rule.id}`}>Colour</Label>
                  <Select value={rule.color} onValueChange={(color) => updateRule(index, { color })} disabled={saving}>
                    <SelectTrigger id={`row-colour-palette-${rule.id}`} aria-label={`Rule ${index + 1} colour`}><SelectValue /></SelectTrigger>
                    <SelectContent>{ACCOUNT_PIC_ROW_COLOR_PALETTE.map((color) => <SelectItem key={color.key} value={color.key}><span className="flex items-center gap-2"><span className={`h-3 w-3 rounded-sm ${color.swatchClass}`} />{color.label}</span></SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-1">
                  <Button type="button" variant="ghost" size="icon" onClick={() => moveRule(index, -1)} disabled={saving || index === 0} aria-label={`Move colour rule ${index + 1} up`}><ArrowUp /></Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => moveRule(index, 1)} disabled={saving || index === draft.length - 1} aria-label={`Move colour rule ${index + 1} down`}><ArrowDown /></Button>
                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => setDraft((current) => current.filter((_, ruleIndex) => ruleIndex !== index))} disabled={saving} aria-label={`Remove colour rule ${index + 1}`}><Trash2 /></Button>
                </div>
              </article>
            );
          })}
          {!draft.length ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No explicit rules. The current legacy Team colours remain until you save a rule set.</div> : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft((current) => [...current, defaultRule(columns, rows)])} disabled={saving || !columns.length || draft.length >= ACCOUNT_PIC_ROW_COLOR_MAX_RULES}><Plus />Add rule</Button>
          <div className="text-xs text-destructive">{error}</div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => onSave(normalizeAccountPicRowColorRules(draft, columns, { strict: true }))} disabled={saving || Boolean(error)}>{saving ? <Loader2 className="animate-spin" /> : <Palette />}Save row colours</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
