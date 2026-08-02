import { createHash } from 'node:crypto';
import {
  SFS_REPORT_AUTOMATION_START_MONTH,
  SFS_REPORT_RECIPIENT,
  buildSfsMonthlyReport,
  sfsReportInputPayload,
} from '../src/hedge/lib/sfsReport.js';
import { DEFAULT_GENERAL, DEFAULT_RATES } from '../src/hedge/lib/domain.js';
import { generateSfsReportCsv, generateSfsReportPdfBuffer, sfsReportFilename } from './_hedgeSfsDocuments.js';
import { resolveGraphEmailSender, sendGraphPurposeMail } from './_graphEmail.js';
import { mopsMonthDateBounds } from './_hedgeMops.js';

function error(message, statusCode = 500, code = null) {
  const next = new Error(message);
  next.statusCode = statusCode;
  if (code) next.code = code;
  return next;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function fingerprint(report) {
  return createHash('sha256').update(JSON.stringify(stable(sfsReportInputPayload(report)))).digest('hex');
}

function monthLabel(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  if (!year || !month) return String(value || '');
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function assertMonth(value) {
  const month = String(value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw error('Choose a valid Hedge Desk report month.', 400);
  return month;
}

function hongKongMonth(now = new Date(), offset = 0) {
  const hongKong = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const shifted = new Date(Date.UTC(hongKong.getUTCFullYear(), hongKong.getUTCMonth() + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function inputs(client, month) {
  const monthBounds = mopsMonthDateBounds(month);
  const [swapResult, priceResult, configResult] = await Promise.all([
    client.from('hedge_swap_hedges').select('*').eq('venue', 'ICE').or(`swap_month.eq.${month},leg1_month.eq.${month},leg2_month.eq.${month}`).limit(5000),
    client.from('hedge_market_prices').select('*').gte('price_date', monthBounds.start).lt('price_date', monthBounds.endExclusive).limit(5000),
    client.from('hedge_settings').select('key,value').in('key', ['rates', 'general']),
  ]);
  const databaseError = swapResult.error || priceResult.error || configResult.error;
  if (databaseError) throw error(`SFS report inputs could not be loaded: ${databaseError.message}`, 502);
  const config = Object.fromEntries((configResult.data || []).map((row) => [row.key, row.value || {}]));
  return {
    swaps: swapResult.data || [],
    mops: priceResult.data || [],
    rates: { ...DEFAULT_RATES, ...(config.rates || {}) },
    sgoRatio: Number(config.general?.sgo_bbl_per_mt || DEFAULT_GENERAL.sgo_bbl_per_mt),
  };
}

async function currentReport(client, month, requireComplete = false) {
  return buildSfsMonthlyReport({
    month,
    ...(await inputs(client, month)),
    requireComplete,
    generatedAt: new Date().toISOString(),
  });
}

async function history(client, month) {
  const closes = await client.from('hedge_month_closes').select('*').eq('report_month', month).order('revision', { ascending: false });
  if (closes.error) throw error(`SFS report history could not be loaded: ${closes.error.message}`, 502);
  const ids = (closes.data || []).map((row) => row.id);
  if (!ids.length) return [];
  const deliveries = await client.from('hedge_report_deliveries').select('*').in('close_id', ids);
  if (deliveries.error) throw error(`SFS delivery history could not be loaded: ${deliveries.error.message}`, 502);
  const deliveryMap = new Map((deliveries.data || []).map((row) => [row.close_id, row]));
  return (closes.data || []).map((row) => ({ ...row, delivery: deliveryMap.get(row.id) || null }));
}

export async function getHedgeSfsMonthReport(client, monthValue) {
  const month = assertMonth(monthValue);
  const preview = await currentReport(client, month);
  const rows = await history(client, month);
  const currentFingerprint = preview.final ? fingerprint(preview) : null;
  const currentRevision = currentFingerprint ? rows.find((row) => row.input_fingerprint === currentFingerprint) || null : null;
  const latestOfficial = rows.find((row) => ['sent', 'superseded'].includes(row.status)) || null;
  return {
    ok: true,
    month,
    preview,
    history: rows,
    latest: rows[0] || null,
    latestOfficial,
    currentRevision,
    currentFingerprint,
    hasUnrecordedChanges: Boolean(currentFingerprint && rows[0] && rows[0].input_fingerprint !== currentFingerprint),
    previewRevision: currentRevision?.revision || Number(rows[0]?.revision || 0) + 1,
    historical: month < SFS_REPORT_AUTOMATION_START_MONTH,
    automationStartMonth: SFS_REPORT_AUTOMATION_START_MONTH,
    recipient: SFS_REPORT_RECIPIENT,
  };
}

export async function getHedgeSfsFile(client, body = {}) {
  let month = assertMonth(body.month);
  const format = String(body.format || 'pdf').toLowerCase();
  if (!['pdf', 'csv'].includes(format)) throw error('Report format must be PDF or CSV.', 400);
  let report;
  let revision = 1;
  let status = 'provisional';
  let finalizedAt = null;
  if (body.closeId) {
    const result = await client.from('hedge_month_closes').select('*').eq('id', body.closeId).maybeSingle();
    if (result.error) throw error(`SFS report snapshot could not be loaded: ${result.error.message}`, 502);
    if (!result.data) throw error('SFS report snapshot was not found.', 404);
    report = result.data.snapshot_json;
    revision = result.data.revision;
    status = result.data.status;
    finalizedAt = result.data.finalized_at;
    month = result.data.report_month;
  } else {
    const state = await getHedgeSfsMonthReport(client, month);
    report = state.preview;
    revision = state.previewRevision;
    status = state.currentRevision?.status || 'provisional_preview';
  }
  const buffer = format === 'csv'
    ? Buffer.from(generateSfsReportCsv(report, { revision, status }), 'utf8')
    : generateSfsReportPdfBuffer(report, { revision, status, finalizedAt });
  return {
    ok: true,
    base64: buffer.toString('base64'),
    mimeType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    filename: body.closeId ? sfsReportFilename(month, revision, format) : `SFS_Realised_PnL_${month}_PREVIEW_R${revision}.${format}`,
  };
}

async function createOrLoadClose(client, month, report, actor) {
  const inputFingerprint = fingerprint(report);
  const rows = await history(client, month);
  const existing = rows.find((row) => row.input_fingerprint === inputFingerprint);
  if (existing) return existing;
  const revision = Number(rows[0]?.revision || 0) + 1;
  const now = new Date().toISOString();
  const created = await client.from('hedge_month_closes').insert({
    report_month: month,
    revision,
    input_fingerprint: inputFingerprint,
    status: 'ready',
    snapshot_json: report,
    finalized_at: now,
    finalized_by: actor.email,
    finalized_by_id: actor.id,
    approved_at: now,
    approved_by: actor.email,
    approved_by_id: actor.id,
  }).select('*').single();
  if (created.error) {
    if (/duplicate|unique/i.test(created.error.message || '')) {
      const refreshed = await history(client, month);
      const concurrent = refreshed.find((row) => row.input_fingerprint === inputFingerprint);
      if (concurrent) return concurrent;
    }
    throw error(`SFS report revision could not be created: ${created.error.message}`, 502);
  }
  return { ...created.data, delivery: null };
}

async function deliveryFor(client, close) {
  if (close.delivery) return close.delivery;
  const existing = await client.from('hedge_report_deliveries').select('*').eq('close_id', close.id).maybeSingle();
  if (existing.error) throw error(`SFS delivery could not be loaded: ${existing.error.message}`, 502);
  if (existing.data) return existing.data;
  const created = await client.from('hedge_report_deliveries').insert({ close_id: close.id, recipient: SFS_REPORT_RECIPIENT, status: 'pending' }).select('*').single();
  if (created.error) throw error(`SFS delivery could not be prepared: ${created.error.message}`, 502);
  return created.data;
}

function attachments(close) {
  const metadata = { revision: close.revision, status: close.revision > 1 ? `revised R${close.revision}` : 'official', finalizedAt: close.finalized_at };
  return [
    { filename: sfsReportFilename(close.report_month, close.revision, 'pdf'), contentType: 'application/pdf', contentBase64: generateSfsReportPdfBuffer(close.snapshot_json, metadata).toString('base64') },
    { filename: sfsReportFilename(close.report_month, close.revision, 'csv'), contentType: 'text/csv', contentBase64: Buffer.from(generateSfsReportCsv(close.snapshot_json, metadata), 'utf8').toString('base64') },
  ];
}

export async function approveAndSendHedgeSfsReport(client, actor, body = {}) {
  const month = assertMonth(body.month);
  const report = await currentReport(client, month, true);
  let close = await createOrLoadClose(client, month, report, actor);
  if (body.closeId && close.id !== body.closeId) throw error('Report inputs changed after this revision was prepared. Review the latest report.', 409);
  if (['sent', 'superseded'].includes(close.status) || close.delivery?.status === 'sent') throw error('This report revision has already been sent.', 409);
  if (!close.approved_at) {
    const approvedAt = new Date().toISOString();
    const approved = await client.from('hedge_month_closes').update({
      status: 'ready',
      approved_at: approvedAt,
      approved_by: actor.email,
      approved_by_id: actor.id,
    }).eq('id', close.id).eq('status', 'pending_approval').select('*').maybeSingle();
    if (approved.error) throw error(`SFS report approval failed: ${approved.error.message}`, 502);
    if (!approved.data) throw error('This SFS report changed before approval. Refresh and review it again.', 409);
    close = { ...approved.data, delivery: close.delivery };
  }
  const delivery = await deliveryFor(client, close);
  const uncertainRetry = delivery.status === 'sending' && Boolean(delivery.last_error);
  if (delivery.status === 'sending' && (!uncertainRetry || body.confirmUncertainResend !== true)) {
    throw error('This report delivery outcome is unresolved. Confirm the uncertain resend only after checking Microsoft 365.', 409);
  }
  const mailboxSnapshot = delivery.sender_mailbox_snapshot
    ? { id: delivery.sender_mailbox_id || null, emailAddress: delivery.sender_mailbox_snapshot }
    : await resolveGraphEmailSender(client, 'hedge_sfs_reports').then((sender) => ({
        id: sender.mailboxId,
        emailAddress: sender.emailAddress,
      }));
  if (!delivery.sender_mailbox_snapshot) {
    const senderSave = await client.from('hedge_report_deliveries').update({
      sender_mailbox_id: mailboxSnapshot.id,
      sender_mailbox_snapshot: mailboxSnapshot.emailAddress,
    }).eq('id', delivery.id).in('status', uncertainRetry ? ['sending'] : ['pending', 'failed']).select('id').maybeSingle();
    if (senderSave.error || !senderSave.data) throw error('The SFS sender mailbox could not be reserved. Refresh and try again.', 409);
  }
  const claimStatuses = uncertainRetry ? ['sending'] : ['pending', 'failed'];
  const claim = await client.from('hedge_report_deliveries').update({ status: 'sending', attempt_count: Number(delivery.attempt_count || 0) + 1, last_attempt_at: new Date().toISOString(), last_error: null }).eq('id', delivery.id).in('status', claimStatuses).select('*').maybeSingle();
  if (claim.error) throw error(`SFS delivery could not be reserved: ${claim.error.message}`, 502);
  if (!claim.data) throw error('This SFS report is already being sent.', 409);
  await client.from('hedge_month_closes').update({ status: 'sending' }).eq('id', close.id);
  try {
    const result = await sendGraphPurposeMail({
      client,
      purposeKey: 'hedge_sfs_reports',
      mailboxSnapshot,
      message: {
        to: SFS_REPORT_RECIPIENT,
        subject: `${close.revision > 1 ? `REVISED R${close.revision} - ` : ''}SFS Realised Swap P&L - ${monthLabel(month)}`,
        text: `Please find attached the SFS realised swap P&L report for ${monthLabel(month)}.`,
        attachments: attachments(close),
      },
    });
    const sentAt = new Date().toISOString();
    const saved = await client.from('hedge_report_deliveries').update({ status: 'sent', sent_at: sentAt, graph_request_id: result.id || null, sender_mailbox_id: mailboxSnapshot.id, sender_mailbox_snapshot: mailboxSnapshot.emailAddress, last_error: null }).eq('id', delivery.id);
    if (saved.error) {
      const uncertain = error('The report was accepted by Microsoft Graph, but FCOS could not confirm delivery. Review before retrying.', 502, 'HEDGE_SFS_CONFIRMATION_UNCERTAIN');
      uncertain.mailDeliveryUncertain = true;
      throw uncertain;
    }
    await client.from('hedge_month_closes').update({ status: 'sent', sent_at: sentAt }).eq('id', close.id);
    await client.from('hedge_month_closes').update({ status: 'superseded' }).eq('report_month', month).lt('revision', close.revision).eq('status', 'sent');
    return { ok: true, closeId: close.id, revision: close.revision, sentAt, senderAddress: result.senderAddress };
  } catch (sendError) {
    if (sendError.mailDeliveryUncertain) {
      await client.from('hedge_report_deliveries').update({ status: 'sending', last_error: String(sendError.message).slice(0, 1000) }).eq('id', delivery.id);
    } else {
      await client.from('hedge_report_deliveries').update({ status: 'failed', last_error: String(sendError.message).slice(0, 1000) }).eq('id', delivery.id);
      await client.from('hedge_month_closes').update({ status: 'failed' }).eq('id', close.id);
    }
    throw sendError;
  }
}

export async function evaluateHedgeSfsCandidates(client, { months = [], dryRun = false, now = new Date() } = {}) {
  const existing = await client.from('hedge_month_closes').select('report_month');
  if (existing.error) throw error(`SFS report candidates could not be loaded: ${existing.error.message}`, 502);
  const candidates = new Set([
    hongKongMonth(now),
    hongKongMonth(now, -1),
    ...(existing.data || []).map((row) => row.report_month),
    ...months,
  ]);
  const results = [];
  for (const month of [...candidates].filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''))).sort()) {
    try {
      const report = await currentReport(client, month);
      if (!report.completeness?.complete) {
        results.push({ month, status: 'incomplete', completeness: report.completeness });
        continue;
      }
      if (!report.final) {
        results.push({ month, status: 'invalid', errors: report.validationErrors || [] });
        continue;
      }
      const inputFingerprint = fingerprint(report);
      const rows = await history(client, month);
      const matching = rows.find((row) => row.input_fingerprint === inputFingerprint);
      if (matching) {
        results.push({ month, status: matching.status, revision: matching.revision });
        continue;
      }
      const revision = Number(rows[0]?.revision || 0) + 1;
      if (dryRun) {
        results.push({ month, status: 'would_create_pending_approval', revision });
        continue;
      }
      const createdAt = now.toISOString();
      const created = await client.from('hedge_month_closes').insert({
        report_month: month,
        revision,
        input_fingerprint: inputFingerprint,
        status: 'pending_approval',
        snapshot_json: report,
        finalized_at: createdAt,
        finalized_by: 'system',
      }).select('id,revision,status').single();
      if (created.error) {
        if (/duplicate|unique/i.test(created.error.message || '')) {
          results.push({ month, status: 'concurrently_recorded' });
          continue;
        }
        throw error(`SFS report candidate could not be saved: ${created.error.message}`, 502);
      }
      await client.from('hedge_events').insert({
        event_type: 'sfs_revision_prepared',
        entity_type: 'MonthClose',
        entity_id: created.data.id,
        label: `SFS report ${month} R${revision} prepared for approval.`,
        metadata: { month, revision },
        actor_email: 'system',
        source: 'fcos',
      });
      results.push({ month, status: created.data.status, revision: created.data.revision });
    } catch (nextError) {
      results.push({ month, status: 'error', error: nextError.message || String(nextError) });
    }
  }
  return results;
}

export async function hedgeSfsHealth(client) {
  const [deliveries, closes] = await Promise.all([
    client.from('hedge_report_deliveries').select('status,last_error,last_attempt_at,sent_at').in('status', ['pending', 'sending', 'failed']).limit(100),
    client.from('hedge_month_closes').select('status,sent_at').order('updated_date', { ascending: false }).limit(100),
  ]);
  const databaseError = deliveries.error || closes.error;
  if (databaseError) return { status: 'Unavailable', detail: databaseError.message };
  const failed = (deliveries.data || []).filter((row) => row.status === 'failed').length;
  const unresolved = (deliveries.data || []).filter((row) => row.status === 'sending').length;
  return {
    status: failed || unresolved ? 'Warning' : 'Online',
    detail: failed ? `${failed} failed report delivery attempt(s).` : unresolved ? `${unresolved} delivery attempt(s) require review.` : 'SFS reporting is available.',
    pending: (deliveries.data || []).filter((row) => row.status === 'pending').length,
    failed,
    unresolved,
  };
}
