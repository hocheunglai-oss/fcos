import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import VariableCharges from '@/components/payments/VariableCharges';
import { appClient } from '@/api/appClient';
import '@/index.css';

const stemId = 'a0H2x0000000001AAA';
const supplierId = '0012x0000000001AAA';
const extraId = 'a042x0000000001AAA';
const side = (name) => ({ status: 'pending', revision: 1, fingerprint: name, permissions: { canEdit: false, canGmOverride: true }, currentAssignee: { id: name, name: `${name} trader` } });
const caseRow = {
  stemId, stemName: 'TEST - GIBRALTAR', portName: 'GIBRALTAR', currency: 'USD',
  pairedWorkflowEnabled: true, hongKongVariableCharges: false, status: 'review',
  canGmOverride: true, capabilities: { canGmOverride: true },
  buyerAccountName: 'Test buyer', salesforceStemLastModifiedAt: '2026-09-11T01:00:00.000Z',
  supplierAccounts: [{ id: supplierId, name: 'Test supplier', isAgent: true, agencyFeeCurrency: '', paymentTerm: '30 I' }],
  supplierRequirements: [{ supplierId, supplierName: 'Test supplier', effectiveRequired: true, status: 'Pending', sides: { cost: side('cost'), buyerCharge: side('buyer') } }],
};
const detail = {
  case: caseRow, pairedWorkflowEnabled: true, lineItems: [], products: [], salesforceFiles: [],
  variableChargeSettings: { usdHkdRate: 7.84, revision: 1 },
  extraCosts: [{ id: extraId, supplierId, productName: 'BASIC CALLING COST', description: '', fixed: true, fixedCost: 1771, fixedPrice: 2150, buyerChargeDecision: 'include', lastModifiedDate: '2026-09-11T01:00:00.000Z' }],
};
window.variableChargeFixture = { requests: [] };
appClient.functions.invoke = async (name, body) => {
  if (name === 'variableChargesList') return { data: { cases: [caseRow], capabilities: caseRow.capabilities } };
  if (name === 'variableChargesDetail') return { data: detail };
  if (name === 'variableChargesSideConfirm') {
    window.variableChargeFixture.requests.push(structuredClone(body));
    return { data: { error: 'Synthetic approval captured; no external write performed.' } };
  }
  throw new Error(`Unexpected fixture operation: ${name}`);
};
createRoot(document.getElementById('root')).render(<MemoryRouter><div className="p-6"><p>Synthetic review fixture — no Salesforce writes</p><VariableCharges initialStemId={stemId} /></div></MemoryRouter>);
