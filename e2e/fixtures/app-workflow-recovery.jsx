import PageMethodology from '@/components/common/PageMethodology';
import { MASTER_CONTRACTS_METHODOLOGY } from '@/lib/pageMethodologyIndex';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/lib/AuthContext';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import StemActivity from '@/components/common/StemActivity';
import RelatedStemSearch from '@/components/common/RelatedStemSearch';
import { AuthenticatedDocumentDownloadButton } from '@/components/common/AuthenticatedDocumentPreview';
import { MemoryRouter } from 'react-router-dom';
import { useRecordDraft } from '@/hooks/useRecordDraft';
import { setClientSessionOwner } from '@/lib/clientSessionState';
import RecordSaveStatus from '@/components/common/RecordSaveStatus';
import WorkflowValidationSummary from '@/components/common/WorkflowValidationSummary';
import WholeTermRevisionPanel from '@/components/special-terms/WholeTermRevisionPanel';
import { ContractEditor } from '@/pages/MasterContracts';
import { appClient } from '@/api/appClient';
import '@/index.css';

// Local fixtures never access a provider or save business records.
setClientSessionOwner('fixture-user-a');
window.recoveryFixture = { calls: [] };
appClient.functions.invoke = async (name, body) => {
  window.recoveryFixture.calls.push({ name, body });
  if (name === 'specialTermMigrationPreviewAll') return { data: { projections: Object.fromEntries(['termsText', 'confirmationRemark', 'nominationRemark'].map((key) => [key, { style: 'Numbered', segments: [{ clauseText: 'Existing China clause.', suggestedShortName: 'China clause', suggestedCategory: 'General' }] }])) } };
  if (name === 'workspaceSearch') return { data: { results: [{ id: 'invoice', stemId: 'a0H000000000001AAA', kind: 'Buyer invoice', label: 'TEST-INV-2026' }], unavailableSources: [] } };
  if (name === 'salesforceStemDetail') return { data: { record: { Id: body.stemId, Name: 'TEST STEM WORKSPACE', _Vessel_Name: 'TEST VESSEL', _Port_Name: 'Hong Kong', Delivery_Date__c: '2026-09-16' }, lineItems: [], extraCosts: [] } };
  if (name === 'salesforceStemDocuments') return { data: { documents: [] } };
  if (name === 'stemWorkspaceActivity') return { data: { events: [{ id: 'event', source: 'Collections', action: 'note_added', createdAt: '2026-09-16T01:00:00Z', actor: 'Test Finance', note: 'Collection reviewed' }], unavailableSources: ['Variable charges'] } };
  return { data: { error: 'Synthetic failure; no provider action attempted.' } };
};
const source = { price: '100', note: '' };
const term = { term: { id: 'a01000000000001AAA', name: 'China', lastModifiedAt: '2026-09-16T00:00:00Z' },
  revision: { id: 'a02000000000001AAA', status: 'Draft', revisionNumber: 2, revisionReason: '', lastModifiedAt: '2026-09-16T00:00:00Z', rules: [] },
  projections: Object.fromEntries(['termsText', 'confirmationRemark', 'nominationRemark'].map((key) => [key, { status: 'Active', style: 'Numbered', assignments: [] }])) };
if (new URLSearchParams(location.search).has('legacy')) { term.revision = null; term.term.revisionStatus = 'Legacy'; term.projections = {}; }
function Form({ base }) {
  const draft = useRecordDraft();
  const { open, update } = draft;
  const [values, setValues] = useState(base);
  const [error, setError] = useState('');
  useLayoutEffect(() => update(values), [update, values]);
  useEffect(() => setValues(open('fixture-record', base)), [open, base]);
  return <section className="space-y-3">
    <RecordSaveStatus draft={draft} error={error} onRecover={() => setValues(draft.recoverUnchanged())} onDiscard={() => setValues(draft.discard())} />
    <label>Price<input id="price" aria-label="Price" value={values.price} onChange={(e) => setValues({ ...values, price: e.target.value })} /></label>
    <label>Note<input aria-label="Note" value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} /></label>
    <button onClick={() => setError('Synthetic failure')}>Fail save</button>
    <WorkflowValidationSummary issues={[{ field: 'price', message: 'Review the price' }]} />
  </section>;
}
function Fixture() {
  const [shown, setShown] = useState(true);
  const [base, setBase] = useState(source);
  const [editor, setEditor] = useState(false);
  const [workspace, setWorkspace] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  return <main className="space-y-4 p-6">
    <PageMethodology {...MASTER_CONTRACTS_METHODOLOGY} />
    <div className="flex flex-wrap gap-4">
      <button onClick={() => setShown((value) => !value)}>Toggle form</button>
      <button onClick={() => setBase({ ...source, price: '150' })}>Change source price</button>
      <button onClick={() => { setShown(false); setClientSessionOwner('fixture-user-b'); }}>Switch user</button>
      <button onClick={() => setTerms((value) => !value)}>Toggle Special Terms</button>
      <button onClick={() => setWorkspace((value) => !value)}>Toggle STEM workspace</button>
      <button onClick={() => setEditor(true)}>Open contract</button>
    </div>
    {shown && <Form base={base} />}
    <RelatedStemSearch contextKey="fixture-message" />
    <AuthenticatedDocumentDownloadButton document={{ fileName: 'Test invoice.pdf', downloadUrl: '/api/functions/salesforceDocumentDownload?id=test', currency: 'HKD', version: 2, status: 'Issued', sourceLabel: 'Salesforce' }} stemId="a0H000000000001AAA" />
    {workspace && <AuthProvider><StemDetailModal stemId="a0H000000000001AAA" open embedded /><StemActivity stemId="a0H000000000001AAA" /></AuthProvider>}
    {terms && <WholeTermRevisionPanel detail={term} canDraft canApprove categoryOptions={[]} audienceOptions={[]} countryOptions={[]} onError={setError} />}
    {error && <p role="alert">{error}</p>}
    <ContractEditor open={editor} onOpenChange={setEditor} detail={null} options={{ accounts: [], contacts: [], ports: [], products: [], users: [], owners: [], vessels: [] }} onOptionsQuery={async () => ({})} onSave={() => setError('Synthetic failure; no contract saved.')} />
  </main>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Fixture /></MemoryRouter>);
