import { fcosSalesforceEnvironment } from '../config/fcosConnections.js';
import { summarizeCombinedXeroFinancialReconciliation } from '../src/lib/xeroFinancialReconciliation.js';
import { requireDeploymentMutationAllowed } from './_deploymentReadOnly.js';
import { xeroContactSyncServiceClient } from './_xeroContactSync.js';
import { loadCreditAllocationSettlementSnapshot } from './_xeroCreditAllocationContext.js';
import { loadPrepaymentSettlementSnapshot } from './_xeroPrepaymentContext.js';
import { XERO_FINANCIAL_CUTOFF, XERO_RECONCILIATION_VERSION, financialPreviewChanges, savedFinancialPreview } from './_xeroFinancialSync.js';
import { boundedSettlementReads } from './_xeroSettlementReads.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_READS = 25;

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status, code: 'XERO_FINANCE_COMPLETION_UNAVAILABLE', expose: true });
}

export async function xeroFinanceCompletion(body = {}, {
  env = process.env, client = xeroContactSyncServiceClient(env), now = Date.now,
  loadPreview = savedFinancialPreview, checkChanges = financialPreviewChanges,
  loadCredits = loadCreditAllocationSettlementSnapshot, loadPrepayments = loadPrepaymentSettlementSnapshot,
  readConnection, accountingFetch,
} = {}) {
  requireDeploymentMutationAllowed(true, env);
  const runId = body.runId;
  if (typeof runId !== 'string' || !UUID.test(runId)) fail('Select a complete saved Finance check.', 400);
  const readRun = columns => client.from('xero_financial_sync_runs').select(columns).eq('id', runId).maybeSingle();
  const saved = await readRun('*');
  const run = saved.data;
  const scope = run?.control_totals?.workflowSnapshot;
  const watermark = Date.parse(run?.source_snapshot_at);
  const cutoff = XERO_FINANCIAL_CUTOFF;
  if (saved.error || run?.id !== runId || run.mode !== 'preview' || run.status !== 'ready_for_review'
      || run.control_totals?.preservationPolicy || run.control_totals?.correctionPolicy || run.cutoff_date !== cutoff
      || scope?.complete !== true || scope.includePayments !== true || scope.recordExactMatches !== false
      || scope.salesforceOrgId !== fcosSalesforceEnvironment('production').orgId
      || scope.reconciliationVersion !== XERO_RECONCILIATION_VERSION || ![1, 2].includes(scope.persistenceVersion)
      || !UUID.test(scope.tenantId || '') || !Number.isSafeInteger(scope.expectedItemCount) || scope.expectedItemCount < 0
      || !Number.isFinite(watermark) || watermark < Date.parse(cutoff) || watermark > now() || now() - watermark > 21_600_000) {
    fail('A current, complete document and payment check is required.');
  }
  const tenantId = scope.tenantId;
  const through = new Date(watermark).toISOString();
  const transport = boundedSettlementReads({ client, tenantId, env, maxXeroReads: MAX_READS, fail, now, readConnection, accountingFetch });
  const preview = await loadPreview(client, run);
  if (!Array.isArray(preview?.rows) || preview.rows.length !== scope.expectedItemCount
      || !Array.isArray(preview.payments?.rows) || preview.payments.tenantId !== tenantId) {
    fail('The saved check no longer has complete document and payment evidence.');
  }
  const connection = await transport.getConnection();
  const window = { cutoff, through };
  const options = { client, tenantId, env, transport };
  const lanes = await Promise.allSettled([loadCredits(window, options), loadPrepayments(window, options)]);
  for (const lane of lanes) {
    if (lane.status === 'rejected') throw lane.reason;
  }
  const [credits, prepayments] = lanes.map(lane => lane.value);
  const changes = await checkChanges(runId, {
    client, connection, env, now: now(), includePayments: true, recordExactMatches: false, accountingFetch: transport.read,
  });
  const current = await readRun('id,revision,status');
  if (changes?.changed !== false || current.error || current.data?.id !== runId
      || current.data.revision !== run.revision || current.data.status !== run.status) {
    fail('The saved Finance check changed. Run the document and payment check again.');
  }
  const summary = summarizeCombinedXeroFinancialReconciliation({
    documentPayments: { ...window, tenantId, complete: true, documents: preview.rows, payments: preview.payments.rows },
    credits, prepayments,
  });
  if (!summary.checked) fail('The four Finance checks do not have matching source and settlement evidence.');
  return { runId, through, checkedAt: new Date(now()).toISOString(), summary, xeroReads: transport.count() };
}
