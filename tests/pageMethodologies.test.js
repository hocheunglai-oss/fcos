import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every authenticated FCOS workspace exposes a Methodology control', () => {
  const sharedControlPages = [
    'src/pages/MyCommitments.jsx',
    'src/pages/DashboardSettings.jsx',
    'src/pages/StemPnlReport.jsx',
    'src/pages/ReviewQueue.jsx',
    'src/pages/DisputeWorkflow.jsx',
    'src/pages/PaymentCollections.jsx',
    'src/pages/UnofficialCompensation.jsx',
    'src/pages/BrokerWorkspace.jsx',
    'src/pages/SettingsWorkspace.jsx',
  ];
  for (const page of sharedControlPages) {
    assert.match(read(page), /PageMethodology/, `${page} should use the shared Methodology control`);
  }

  const specializedPages = [
    'src/pages/AccountManagers.jsx',
    'src/pages/CashflowForecast.jsx',
    'src/pages/GrowthCoaching.jsx',
    'src/pages/ProjectsTasks.jsx',
  ];
  for (const page of specializedPages) {
    assert.match(read(page), /Methodology/, `${page} should retain its specialized Methodology guide`);
  }
});

test('integrated workspaces provide methodology for every tab or section', () => {
  const methodologies = read('src/lib/pageMethodologies.js');
  const settingsWorkspace = read('src/pages/SettingsWorkspace.jsx');
  assert.match(methodologies, /PAYMENT_COLLECTIONS_METHODOLOGIES[\s\S]*collections:[\s\S]*incoming:[\s\S]*reconciliation:/);
  assert.match(methodologies, /BROKER_METHODOLOGIES[\s\S]*commissions:[\s\S]*archive:/);
  assert.match(methodologies, /SETTINGS_METHODOLOGIES[\s\S]*system:[\s\S]*users:[\s\S]*audit:/);
  assert.match(settingsWorkspace, /const methodologyAction = <PageMethodology/);
  assert.match(settingsWorkspace, /<SettingsPage methodologyAction=\{methodologyAction\}/);
  assert.match(settingsWorkspace, /<AdminControl methodologyAction=\{methodologyAction\}/);
  assert.match(settingsWorkspace, /<UniversalAuditTrail methodologyAction=\{methodologyAction\}/);
  assert.doesNotMatch(settingsWorkspace, /<PageMethodology[^>]*className="ml-auto"/);
});

test('the shared Methodology dialog remains readable on constrained viewports', () => {
  const component = read('src/components/common/PageMethodology.jsx');
  assert.match(component, /max-h-\[85vh\]/);
  assert.match(component, /overflow-y-auto/);
  assert.match(component, /max-w-2xl/);
  assert.match(component, /CircleHelp/);
});
