import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { valueList } from './EmailRecipientPicker';

export default function EmailPresetPicker({ presets, selectedId = 'none', onSelect, disabled = false }) {
  const items = valueList(presets);

  return <div className="flex min-h-9 flex-wrap gap-2" role="group" aria-label="Routing preset">
    {items.length ? items.map((preset) => {
      const value = String(preset.id || preset.value);
      const selected = value === selectedId;
      return <Button
        key={value}
        type="button"
        variant={selected ? 'default' : 'outline'}
        size="sm"
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => onSelect(selected ? 'none' : value)}
        className="font-semibold"
      >
        {selected && <Check className="h-3.5 w-3.5" />}
        {preset.label || preset.displayName || preset.name || value}
      </Button>;
    }) : <p className="py-2 text-xs text-muted-foreground">No routing presets are available.</p>}
  </div>;
}
