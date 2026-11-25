import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function deliveryError(message, status, code) {
  return Object.assign(new Error(message), { status, code, expose: true });
}

export function buyerInvoiceReportConfirmation({ actorId, revision, report, message, secret = process.env.CRON_SECRET }) {
  const stablePayload = [
    report.today, report.dueThrough, report.daysAhead, report.selectedBuyerTraders,
    report.rows.map(row => row.stemId),
    message.to, message.cc, message.bcc, message.subject, message.html, message.text,
  ];
  const digest = createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
  const confirmation = actorId && secret
    ? createHmac('sha256', secret).update(JSON.stringify(['fcos-buyer-invoice-report/v1', actorId, revision, digest])).digest('hex')
    : null;
  return { confirmation, runKey: `manual-outstanding-invoices:v1:${digest}` };
}

export function assertBuyerInvoiceReportConfirmation(expected, supplied) {
  if (!expected || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
    || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))) {
    throw deliveryError('Preview the current report and recipients before sending.', 409, 'BUYER_INVOICE_REPORT_PREVIEW_REQUIRED');
  }
}

const unconfirmed = () => deliveryError(
  'Delivery is unconfirmed. Verify the original email in the sending mailbox before taking further action.',
  409, 'BUYER_INVOICE_REPORT_DELIVERY_UNCONFIRMED',
);

export async function submitBuyerInvoiceReportOnce(client, { runKey, rowCount }, send) {
  if (!client) throw deliveryError('Report delivery history is unavailable.', 503, 'BUYER_INVOICE_REPORT_LEDGER_UNAVAILABLE');
  const table = () => client.from('buyer_invoice_email_runs');
  const { error } = await table().insert({ run_key: runKey, status: 'running', rows_count: rowCount });
  if (error?.code === '23505') {
    const { data, error: readError } = await table().select('status,provider_result').eq('run_key', runKey).maybeSingle();
    if (!readError && data?.status === 'sent') return { id: data.provider_result?.id || null, replayed: true };
    throw unconfirmed();
  }
  if (error) throw deliveryError('Report delivery could not be reserved. Check delivery history before retrying.', 503, 'BUYER_INVOICE_REPORT_LEDGER_UNAVAILABLE');
  try {
    const result = await send();
    const id = result.id || null;
    const { data, error: completionError } = await table()
      .update({ status: 'sent', provider_result: { id }, completed_at: new Date().toISOString() })
      .eq('run_key', runKey).eq('status', 'running').select('run_key').single();
    if (completionError || data?.run_key !== runKey) throw unconfirmed();
    return { ...result, replayed: false };
  } catch {
    // Retain the original reservation even if Graph or the ledger lost its acknowledgement.
    throw unconfirmed();
  }
}
