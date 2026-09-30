import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DashboardSettings from '@/pages/DashboardSettings';
import MissingNomB from '@/pages/MissingNomB';
import MyCommitments from '@/pages/MyCommitments';
import { appClient } from '@/api/appClient';
import '@/styles/fonts.css';
import '@/index.css';

const params = new URLSearchParams(window.location.search);
const manager = params.get('role') === 'manager';
const makeRow = (index, extra = {}) => ({
  stemId: `fixture-stem-${index}`, stemReference: `STEM-${String(index).padStart(3, '0')}`, vessel: index === 1 ? 'Pacific Endeavour' : `Marine vessel ${index}`,
  buyer: 'Synthetic Marine Fuels Holdings Limited', port: 'Hong Kong', deliveryDate: '2026-09-18', deliveryDateSource: index % 2 ? 'actual' : 'expected', status: 'missing',
  traders: [{ id: 'trader-1', name: 'Ada Trader', email: 'ada@example.invalid' }],
  receivable: { amount: 2000, currency: 'EUR', usdEquivalent: 2340, rate: '117/100', rateDate: '2026-09-18', rateSource: 'Salesforce company accounting rate', evidenceStatus: 'verified', invoiceIds: ['INVOICE-001'] },
  policy: { mode: 'automatic', reasonCode: null, reasonText: '', revision: 0 },
  confirmations: [{ id: 'filing-1', name: 'Nom B draft', traderName: 'Ada Trader', status: 'Draft', filingUrl: 'https://salesforce.example.invalid/filing-1' }], stemUrl: 'https://salesforce.example.invalid/stem-1', ...extra,
});
const rows = [
  ...Array.from({ length: 26 }, (_, index) => makeRow(index + 1)),
  makeRow(27, { status: 'waived', waiverType: 'automatic', reason: 'Verified issued-invoice receivable is below USD 100.', receivable: { amount: 99, currency: 'USD', usdEquivalent: 99, rate: 1, rateDate: '2026-09-18', invoiceIds: ['INVOICE-027'], evidenceStatus: 'verified' } }),
  makeRow(28, { status: 'unable_to_verify', reason: 'Issued-invoice currency could not be verified.', receivable: { amount: null, currency: null, usdEquivalent: null, rate: null, rateDate: null, evidenceStatus: 'unavailable' } }),
  makeRow(29, { undated: true, deliveryDate: null, deliveryDateSource: null }),
  makeRow(30, { traders: [], reason: 'Trader assignment could not be resolved.' }),
];
window.nomBFixture = { user: { id: 'fixture-user', read_only_ci: params.get('role') === 'ci' }, requests: [], saves: [], rows, pending: [], deferView: null, readFailure: params.get('read') === 'fail', unknown: params.get('unknown') === '1', mutation: 'success', revision: 0 };
appClient.functions.invoke = async (name, body = {}, options = {}) => {
  const fixture = window.nomBFixture;
  fixture.requests.push({ name, body: structuredClone(body), force: Boolean(options.force) });
  if (name === 'dashboardSummary') return { data: { complete: true, matchingCount: 0, accountCount: 0, disputedCount: 0, financials: [] } };
  if (name === 'dashboardStemList') return { data: { stems: [], matchingCount: 0 } };
  if (name === 'dashboardFilterOptions' || name === 'dashboardCounterpartyOptions') return { data: { options: [] } };
  if (name === 'workCommitmentsList') return { data: { commitments: [{ id: 'fixture-task', source: 'collaboration', urgency: 'needs_action', title: 'Synthetic commitment', link: '/projects-tasks', actionLabel: 'Open' }], counts: { needs_action: 1 }, sources: ['collaboration'] } };
  if (name === 'salesforceStemDetail') return { data: { record: { Id: body.stemId, Name: 'Opened fixture STEM', Vessel_Name__c: 'Pacific Endeavour' }, lineItems: [], extraCosts: [] } };
  if (name === 'salesforceStemDocuments') return { data: { documents: [] } };
  if (name === 'missingNomBList') return { data: {
    rows: [{ nominationId: 'fixture-confirmation-1', stemId: 'fixture-stem-1', stemName: 'STEM-001', buyerName: 'Synthetic Marine Fuels Holdings Limited', vesselName: 'Pacific Endeavour', imo: '9000001', portName: 'Hong Kong', deliveryDate: '2026-09-18', expectedDeliveryDate: null, confirmationReference: 'BC-001', traderName: 'Ada Trader', receivedStatus: '🟡', canUpload: true }],
    nextCursor: null,
    asOf: '2026-09-30T04:00:00Z',
  } };
  if (name === 'dashboardNomBRead') {
    if (fixture.readFailure) return { data: { error: 'Salesforce verification unavailable.', code: 'NOM_B_SOURCE_UNAVAILABLE' } };
    const getResponse = () => {
      const scoped = fixture.rows.filter((row) => body.scope === 'team' || row.traders.length);
      const dated = scoped.filter((row) => !row.undated);
      const filtered = scoped.filter((row) => Boolean(row.undated) === Boolean(body.includeUndated) && row.status === body.view && (!body.traderId || (body.traderId === 'unassigned' ? !row.traders.length : row.traders.some((trader) => trader.id === body.traderId))) && (!body.search || JSON.stringify(row).toLowerCase().includes(body.search.toLowerCase())));
      if (body.sort === 'delivery_desc') filtered.reverse();
      return { data: { success: true, scope: { from: '2026-09-01' }, complete: !fixture.unknown, lastCheckedAt: '2026-09-29T09:00:00Z', capabilities: { canManagePolicies: manager, canViewTeam: manager },
        counts: { missing: fixture.unknown ? null : dated.filter((row) => row.status === 'missing').length, waived: dated.filter((row) => row.status === 'waived').length, unableToVerify: dated.filter((row) => row.status === 'unable_to_verify').length, undated: scoped.filter((row) => row.undated).length, complete: !fixture.unknown },
        traderOptions: [{ id: 'trader-1', name: 'Ada Trader' }], rows: structuredClone(filtered.slice((body.page - 1) * body.pageSize, body.page * body.pageSize)), pagination: { page: body.page, pageSize: body.pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / body.pageSize) } } };
    };
    if (fixture.deferView === body.view) return new Promise((resolve) => fixture.pending.push(() => resolve(getResponse())));
    return getResponse();
  }
  if (name === 'dashboardNomBPolicySave') {
    fixture.saves.push(structuredClone(body));
    if (fixture.mutation === 'conflict') { fixture.rows.find((row) => row.stemId === body.stemId).policy.revision = 1; return { data: { error: 'Concurrent policy change.', code: 'NOM_B_REVISION_CONFLICT' } }; }
    if (fixture.mutation === 'failure') return { data: { error: 'Policy storage is unavailable.' } };
    const row = fixture.rows.find((item) => item.stemId === body.stemId);
    row.policy = { mode: body.mode, reasonCode: body.reasonCode, reasonText: body.reasonText, revision: row.policy.revision + 1 };
    row.status = body.mode === 'waive' ? 'waived' : 'missing'; row.waiverType = body.mode === 'waive' ? 'manual' : null;
    return { data: { success: true, policy: structuredClone(row.policy) } };
  }
  if (name === 'dashboardNomBAuditRead') return { data: { success: true, rows: [{ id: 'audit-status', createdAt: '2026-09-29T09:00:00Z', actorName: 'System', eventType: 'status_changed', previousStatus: 'missing', status: 'waived', evidence: {} }, { id: 'audit-1', createdAt: '2026-09-28T10:30:00Z', actorName: 'Mira Manager', eventType: 'policy_updated', previousMode: 'waive', mode: 'require', reasonCode: 'management_exception', reasonText: 'Recheck payment evidence before filing.', evidence: { invoiceIssued: true, rateDate: '2026-09-18' } }], pagination: { page: 1, totalPages: 1 } } };
  return { data: { error: `Unexpected isolated fixture request: ${name}` } };
};
const dashboard = params.get('screen') === 'dashboard';
createRoot(document.getElementById('root')).render(<StrictMode><MemoryRouter initialEntries={[dashboard ? '/' : '/my-commitments?source=nom_b']}><p className="p-3 text-xs">Synthetic Nom B fixture — no live provider data</p><Routes><Route path="/" element={<DashboardSettings />} /><Route path="/my-commitments" element={<MyCommitments />} /><Route path="/missing-nom-b" element={<MissingNomB />} /></Routes></MemoryRouter></StrictMode>);
