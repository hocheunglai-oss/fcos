const SIDES = [
  { value: 'both', label: 'Both' },
  { value: 'buyer', label: 'Buyer' },
  { value: 'supplier', label: 'Supplier' },
];

export default function CreditStatementSideToggle({ value, availableSides = [], onChange }) {
  const available = new Set(availableSides);
  return (
    <div className="flex rounded-md border border-border bg-muted/30 p-1" aria-label="Credit statement view">
      {SIDES.map((side) => {
        const enabled = available.has(side.value);
        return (
          <button
            type="button"
            key={side.value}
            aria-pressed={value === side.value}
            disabled={!enabled}
            title={enabled ? `Show ${side.label.toLowerCase()} credit exposure` : `${side.label} exposure is unavailable for this Account or GROUP`}
            onClick={() => enabled && side.value !== value && onChange?.(side.value)}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${value === side.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {side.label}
          </button>
        );
      })}
    </div>
  );
}
