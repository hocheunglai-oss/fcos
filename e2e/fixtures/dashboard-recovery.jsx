import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import DashboardSettings from '@/pages/DashboardSettings';
import { appClient } from '@/api/appClient';
import '@/index.css';

// Opt-in local fixture: render the actual Dashboard with all provider calls stubbed.
window.dashboardRecovery = { requests: [], mode: 'fail', pending: [] };
appClient.functions.invoke = async (name, body, options = {}) => {
  const fixture = window.dashboardRecovery;
  fixture.requests.push({ name, body: structuredClone(body), force: Boolean(options.force) });
  if (name === 'dashboardSummary') return { data: { matchingCount: 0, accountCount: 0, disputedCount: 0, financials: [] } };
  if (name === 'dashboardStemList') return { data: { stems: [], matchingCount: 0 } };
  if (name === 'dashboardFilterOptions') return { data: { options: [] } };
  if (name === 'dashboardAnalytics') {
    if (fixture.mode === 'pending') return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (fixture.mode === 'fail') throw new Error('Salesforce is temporarily unavailable.');
    return { data: { rankings: { accountsByNetPnl: [{ accountId: 'test', name: 'Recovered buyer', currency: 'USD', netPnl: 100 }] } } };
  }
  throw new Error(`Unexpected fixture request: ${name}`);
};
createRoot(document.getElementById('root')).render(<StrictMode><MemoryRouter><AuthProvider><DashboardSettings/></AuthProvider></MemoryRouter></StrictMode>);
