import { Navigate, useParams, useSearchParams } from 'react-router-dom';

const copyQueryValue = (source, target, from, to) => {
  const value = source.get(from);
  if (value) target.set(to, value);
};

export default function AccountInsight() {
  const { accountId } = useParams();
  const [searchParams] = useSearchParams();
  const role = ['buyer', 'supplier', 'group', 'both'].includes(searchParams.get('role')) ? searchParams.get('role') : 'buyer';
  const initialTab = ['overview', 'trading', 'payments', 'risk', 'stems', 'credit', 'children'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const next = new URLSearchParams({
    tab: 'accounts',
    insightAccountId: accountId || '',
    insightName: searchParams.get('name') || 'Account',
    insightRole: role,
    insightRoles: searchParams.get('roles') || (role === 'both' ? 'buyer,supplier' : ['buyer', 'supplier'].includes(role) ? role : 'buyer'),
    insightEntityType: searchParams.get('entityType') === 'group' ? 'group' : 'account',
    insightTab: initialTab,
    insightStatementSide: ['both', 'buyer', 'supplier'].includes(searchParams.get('statementSide')) ? searchParams.get('statementSide') : role === 'both' ? 'both' : role === 'supplier' ? 'supplier' : 'buyer',
    insightPeriod: searchParams.get('period') || 'dashboard_period',
    insightScope: searchParams.get('scope') === 'account_wide' ? 'account_wide' : 'dashboard',
  });
  [
    ['years', 'insightYears'], ['months', 'insightMonths'], ['disputeOnly', 'insightDisputeOnly'],
    ['accountIds', 'insightAccountIds'], ['supplierIds', 'insightSupplierIds'], ['portIds', 'insightPortIds'],
    ['countryCodes', 'insightCountryCodes'], ['company', 'insightCompany'], ['group', 'insightGroup'],
    ['port', 'insightPort'], ['country', 'insightCountry'],
  ].forEach(([from, to]) => copyQueryValue(searchParams, next, from, to));
  return <Navigate replace to={`/?${next.toString()}`} />;
}
