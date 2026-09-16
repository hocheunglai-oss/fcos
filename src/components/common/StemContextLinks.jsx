import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function StemContextLinks({ stemId, className = '' }) {
  const { hasModuleAccess } = useAuth();
  if (!stemId) return null;
  const id = encodeURIComponent(stemId);
  const links = [
    { label: 'Collections', module: 'buyer_invoices', to: `/payment-collections?tab=collections&collectionStemId=${id}` },
    { label: 'Variable charges', module: 'buyer_invoices', to: `/payment-collections?tab=variable-charges&stemId=${id}` },
    { label: 'Dispute agreement & settlement', module: 'disputes', to: `/disputes?stem=${id}` },
    { label: 'Accounting reconciliation', module: 'xero_portal', to: `/xero-portal?stem=${id}` },
  ].filter((link) => hasModuleAccess(link.module));
  return <nav aria-label="Related STEM work" className={`flex flex-wrap gap-2 ${className}`}>
    {links.map((link) => <Link key={link.module + link.label} to={link.to} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted">{link.label}</Link>)}
  </nav>;
}
