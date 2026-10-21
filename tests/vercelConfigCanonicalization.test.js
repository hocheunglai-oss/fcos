import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('FCOS deployment config retains the observed platform canonical form and schedules', () => {
  const bytes = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  const config = JSON.parse(bytes);
  assert.equal(config.name, 'fcos');
  assert.equal(config.version, 2);
  assert.equal(bytes, `${JSON.stringify(config)}\n`);
  assert.deepEqual(config.regions, ['sin1']);
  assert.deepEqual(config.crons, [
    { path: '/api/functions/missingNomBReminderCron', schedule: '*/5 * * * *' },
    { path: '/api/functions/outstandingBuyerInvoicesEmailCron', schedule: '0 0 * * 1-5' },
    { path: '/api/functions/outstandingBuyerInvoicesEmailCron', schedule: '0 6 * * 1-5' },
    { path: '/api/functions/paymentCollectionsReconcileCron', schedule: '30 23 * * 0-4' },
    { path: '/api/functions/portalEntitlementSyncCron', schedule: '30 18 * * *' },
    { path: '/api/functions/collaborationDailyCron', schedule: '0 1 * * *' },
    { path: '/api/functions/growthCoachingDailyCron', schedule: '30 0 * * 1-5' },
    { path: '/api/functions/hedgeDeskMaintenanceCron', schedule: '30 0 * * *' },
    { path: '/api/functions/marketReportDriveSyncCron', schedule: '0 * * * *' },
    { path: '/api/functions/masterContractReconcileCron', schedule: '15 * * * *' },
    { path: '/api/functions/emailRouterMaintenanceCron', schedule: '*/5 * * * *' },
  ]);
  assert.equal(config.git.deploymentEnabled.main, false);
  assert.notEqual(config.git.deploymentEnabled['codex/hosted-release-consolidation-20261017'], false);
});
