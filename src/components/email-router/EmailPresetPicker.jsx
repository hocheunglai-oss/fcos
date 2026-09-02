import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { valueList } from './EmailRecipientPicker';

export default function EmailPresetPicker({ presets, selectedId = 'none', onSelect, disabled = false, compact = false }) {
  const items = valueList(presets);

  return <div className={compact ? 'flex min-h-7 flex-wrap gap-1' : 'flex min-h-9 flex-wrap gap-2'} role="group" aria-label="Routing preset">
    {items.length ? items.map((preset) => {
      const value = String(preset.id || preset.value);
      const selected = value === selectedId;
      return <Button
        key={value}
        type="button"
        variant={selected ? 'default' : 'outline'}
        size="sm"
        aria-pressed={selected}
        disabled={disabled || preset.available === false}
        title={preset.available === false ? preset.configurationIssue || 'This routing preset is unavailable.' : undefined}
        onClick={() => onSelect(selected ? 'none' : value)}
        className={compact ? 'h-7 gap-1 px-2 text-[11px] font-semibold' : 'font-semibold'}
      >
        {selected && <Check className="h-3.5 w-3.5" />}
        {preset.label || preset.displayName || preset.name || value}
      </Button>;
    }) : <p className="py-2 text-xs text-muted-foreground">No routing presets are available.</p>}
  </div>;
}
