import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Calculator } from 'lucide-react';

const AGGREGATE_FNS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'COUNT_DISTINCT'];

// A calculated field is either:
// - An aggregate: SUM(Amount__c) → aliased
// - A formula expression shown as a computed column client-side
export default function CalculatedFields({ calcFields, onChange, fields }) {
  const numericFields = fields.filter(f =>
    ['double', 'currency', 'integer', 'percent'].includes(f.type)
  );

  const add = () => {
    onChange([
      ...calcFields,
      { id: Date.now(), label: '', type: 'aggregate', fn: 'SUM', field: numericFields[0]?.name || '' }
    ]);
  };

  const update = (id, patch) => onChange(calcFields.map(c => c.id === id ? { ...c, ...patch } : c));
  const remove = (id) => onChange(calcFields.filter(c => c.id !== id));

  return (
    <div className="space-y-2">
      {calcFields.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calculated fields. Add aggregates like SUM, AVG, COUNT.</p>
      ) : (
        calcFields.map(cf => (
          <div key={cf.id} className="flex items-center gap-2 flex-wrap">
            {/* Function */}
            <Select value={cf.fn} onValueChange={v => update(cf.id, { fn: v })}>
              <SelectTrigger className="w-32 h-8 text-xs font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATE_FNS.map(fn => (
                  <SelectItem key={fn} value={fn} className="text-xs font-mono">{fn}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground text-sm">(</span>

            {/* Field */}
            <Select value={cf.field} onValueChange={v => update(cf.id, { field: v })}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="Field…" />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {(cf.fn === 'COUNT' || cf.fn === 'COUNT_DISTINCT'
                  ? fields
                  : numericFields
                ).map(f => (
                  <SelectItem key={f.name} value={f.name} className="text-xs">{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground text-sm">)</span>
            <span className="text-muted-foreground text-xs">as</span>

            {/* Alias label */}
            <Input
              className="w-32 h-8 text-xs"
              placeholder="alias"
              value={cf.label}
              onChange={e => update(cf.id, { label: e.target.value })}
            />

            <button onClick={() => remove(cf.id)} className="text-muted-foreground hover:text-destructive p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}

      <Button size="sm" variant="ghost" onClick={add} className="h-7 text-xs gap-1 text-primary mt-1">
        <Plus className="w-3 h-3" /> Add Aggregate
      </Button>

      {calcFields.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
          <Calculator className="w-3 h-3" />
          Aggregates require GROUP BY — select grouping fields in the columns section.
        </p>
      )}
    </div>
  );
}