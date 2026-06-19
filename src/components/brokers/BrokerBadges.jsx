const typeClasses = {
  'Supplier Broker': 'bg-orange-100 text-orange-700 border-orange-200',
  'Buyer Broker': 'bg-blue-100 text-blue-700 border-blue-200',
  'Secondary Buyer Broker': 'bg-purple-100 text-purple-700 border-purple-200',
};

export function BrokerTypeBadge({ type }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${typeClasses[type] || 'bg-muted text-muted-foreground border-border'}`}>
      {type}
    </span>
  );
}

export function PaymentStatusBadge({ status }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cls = status === 'Exported'
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : 'bg-muted text-muted-foreground border-border';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}