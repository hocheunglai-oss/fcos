import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AccountInsightModal from '@/components/dashboard/AccountInsightModal';

function numbers(value, fallback) {
  const rows = String(value || '').split(',').map(Number).filter(Number.isInteger);
  return rows.length ? rows : fallback;
}

export default function AccountInsight() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = ['buyer', 'supplier', 'group', 'both'].includes(searchParams.get('role')) ? searchParams.get('role') : 'buyer';
  const initialTab = ['overview', 'trading', 'payments', 'risk', 'stems', 'credit', 'children'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const current = new Date();
  const selectedYears = numbers(searchParams.get('years'), [current.getFullYear()]);
  const selectedMonths = numbers(searchParams.get('months'), [current.getMonth() + 1]);
  const dashboardScope = useMemo(() => ({
    mode: searchParams.get('scope') === 'account_wide' ? 'account_wide' : 'dashboard',
    disputeOnly: searchParams.get('disputeOnly') === '1',
    filters: {
      accountIds: String(searchParams.get('accountIds') || '').split(',').filter(Boolean),
      supplierIds: String(searchParams.get('supplierIds') || '').split(',').filter(Boolean),
      portIds: String(searchParams.get('portIds') || '').split(',').filter(Boolean),
      countryCodes: String(searchParams.get('countryCodes') || '').split(',').filter(Boolean),
    },
    labels: {
      company: searchParams.get('company') || '', group: searchParams.get('group') || '',
      port: searchParams.get('port') || '', country: searchParams.get('country') || '',
    },
  }), [searchParams]);
  const updateView = ({ role: nextRole, tab, periodMode, accountWide }) => {
    const next = new URLSearchParams(searchParams);
    next.set('role', nextRole); next.set('tab', tab); next.set('period', periodMode); next.set('scope', accountWide ? 'account_wide' : 'dashboard');
    setSearchParams(next, { replace: true });
  };
  return <main className="min-h-[70vh]"><AccountInsightModal account={{ accountId, name: searchParams.get('name') || 'Account', role, entityType: searchParams.get('entityType') === 'group' ? 'group' : 'account', initialTab }} open onClose={() => navigate('/?tab=accounts')} selectedYears={selectedYears} selectedMonths={selectedMonths} dashboardScope={dashboardScope} initialPeriodMode={searchParams.get('period') || 'dashboard_period'} onViewChange={updateView} /></main>;
}
