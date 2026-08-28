import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const SOURCE_BUCKET = 'invoice-pdfs';
const TARGET_BUCKET = 'hedge-documents';
const APPLY = process.argv.includes('--apply');
const VERIFY_ONLY = process.argv.includes('--verify-only');
const MODE = VERIFY_ONLY ? 'verification' : APPLY ? (process.argv.includes('--delta') ? 'delta' : 'initial') : 'dry_run';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function client(urlName, keyName) {
  return createClient(required(urlName), required(keyName), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function emailList(value) {
  return [...new Set(String(value || '').split(/[\n,]/).map(normalizedEmail).filter(Boolean))];
}

function sourceProjectRef(url) {
  return new URL(url).hostname.split('.')[0];
}

function isoDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function isoTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function number(value) {
  if (value == null || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function bool(value, fallback = false) {
  return value == null ? fallback : value === true;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sum(rows, field) {
  return Math.round(rows.reduce((total, row) => total + (number(row?.[field]) || 0), 0) * 1e8) / 1e8;
}

async function allRows(db, table, select = '*', orderColumn = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await db.from(table).select(select).order(orderColumn, { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(`${table} could not be loaded: ${result.error.message}`);
    rows.push(...(result.data || []));
    if ((result.data || []).length < PAGE_SIZE) return rows;
  }
}

async function upsertRows(db, table, rows, onConflict = 'legacy_source_id', options = {}) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += 250) {
    const result = await db.from(table).upsert(rows.slice(index, index + 250), { onConflict, ...options });
    if (result.error) throw new Error(`${table} import failed: ${result.error.message}`);
  }
}

function actorIdFor(value, profileByEmail) {
  return profileByEmail.get(normalizedEmail(value))?.id || null;
}

function common(row, profileByEmail) {
  return {
    legacy_source_id: String(row.id),
    created_date: isoTimestamp(row.created_date) || new Date().toISOString(),
    updated_date: isoTimestamp(row.updated_date) || isoTimestamp(row.created_date) || new Date().toISOString(),
    created_by: String(row.created_by || 'legacy').slice(0, 320),
    created_by_id: actorIdFor(row.created_by, profileByEmail),
    updated_by_id: actorIdFor(row.created_by, profileByEmail),
  };
}

function cleanLegacySetting(value) {
  if (Array.isArray(value)) return value.map(cleanLegacySetting);
  if (!value || typeof value !== 'object') return value;
  const blocked = /(?:smtp|password|secret|token|credential|client_secret|email_from|from_email|sender_mailbox)/i;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key)).map(([key, child]) => [key, cleanLegacySetting(child)]));
}

function sourceActiveUsers(configs) {
  const auth = configs.find((row) => row.key === 'google_auth')?.value || {};
  return emailList(auth.allowed_emails);
}

function identityOverrides() {
  const raw = String(process.env.HEDGE_SOURCE_IDENTITY_MAP_JSON || '').trim();
  if (!raw) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('HEDGE_SOURCE_IDENTITY_MAP_JSON must be a JSON object of reviewed source-to-FCOS email mappings.');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('HEDGE_SOURCE_IDENTITY_MAP_JSON must be a JSON object of reviewed source-to-FCOS email mappings.');
  }
  const result = new Map();
  for (const [sourceValue, targetValue] of Object.entries(parsed)) {
    const sourceEmail = normalizedEmail(sourceValue);
    const targetEmail = normalizedEmail(targetValue);
    if (!sourceEmail || !targetEmail) throw new Error('Every reviewed Hedge Desk identity mapping must contain two valid email addresses.');
    result.set(sourceEmail, targetEmail);
  }
  return result;
}

function assertIdentityMapping(sourceEmails, profiles, overrides = new Map()) {
  const profileByEmail = new Map();
  const profilesByEmail = new Map();
  for (const profile of profiles) {
    const email = normalizedEmail(profile.email);
    if (!email) continue;
    if (!profilesByEmail.has(email)) profilesByEmail.set(email, []);
    profilesByEmail.get(email).push(profile);
  }
  for (const [email, rows] of profilesByEmail) {
    const active = rows.filter((row) => row.active === true);
    if (active.length > 1) throw new Error(`Multiple active FCOS profiles use ${email}. Resolve the duplicate before cutover.`);
    if (active.length === 1) profileByEmail.set(email, active[0]);
    else if (rows.length === 1) profileByEmail.set(email, rows[0]);
  }
  for (const [sourceEmail, targetEmail] of overrides) {
    if (!sourceEmails.includes(sourceEmail)) throw new Error(`The reviewed source identity ${sourceEmail} is not an active Hedge Desk user.`);
    const target = profileByEmail.get(targetEmail);
    if (target?.active !== true) throw new Error(`The reviewed FCOS identity ${targetEmail} is not one unique active profile.`);
    profileByEmail.set(sourceEmail, target);
  }
  const unmatched = sourceEmails.filter((email) => profileByEmail.get(email)?.active !== true);
  if (unmatched.length) throw new Error(`Active Hedge Desk users do not match active FCOS profiles: ${unmatched.join(', ')}.`);
  return profileByEmail;
}

async function loadSource(source) {
  const names = [
    'physical_trades', 'swap_hedges', 'mops_prices', 'clearing_accounts', 'invoices',
    'counterparties', 'audit_logs', 'app_configs', 'integration_health',
    'integration_operations', 'sfs_month_closes', 'sfs_report_deliveries',
  ];
  const values = await Promise.all(names.map((name) => allRows(source, name)));
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

async function activeGeneralManager(target, profiles) {
  const { data, error } = await target
    .from('collaboration_roles')
    .select('user_id')
    .eq('role', 'general_manager')
    .eq('active', true);
  if (error) throw new Error(`The active General Manager could not be resolved: ${error.message}`);
  if ((data || []).length !== 1) throw new Error('Exactly one active General Manager is required before Hedge Desk cutover.');
  const profile = profiles.find((row) => row.id === data[0].user_id && row.active === true);
  if (!profile) throw new Error('The active General Manager role does not belong to an active FCOS profile.');
  return profile;
}

function mappedRows(source, profileByEmail) {
  return {
    hedge_physical_trades: source.physical_trades.map((row) => ({
      ...common(row, profileByEmail),
      trade_date: isoDate(row.trade_date), product: row.product, counterparty: row.counterparty,
      qty_min: number(row.qty_min), qty_max: number(row.qty_max), unit: row.unit, vessel_name: row.vessel_name,
      delivery_date_from: isoDate(row.delivery_date_from), delivery_date_to: isoDate(row.delivery_date_to),
      sell_price_type: row.sell_price_type, sell_price: number(row.sell_price), sell_premium: number(row.sell_premium),
      sell_pricing_month: row.sell_pricing_month, sell_pricing_basis: row.sell_pricing_basis, sell_bal_date: isoDate(row.sell_bal_date),
      buy_price_type: row.buy_price_type, buy_price: number(row.buy_price), buy_premium: number(row.buy_premium),
      buy_pricing_month: row.buy_pricing_month, buy_pricing_basis: row.buy_pricing_basis, buy_bal_date: isoDate(row.buy_bal_date),
      notes: row.notes, stem_number: row.stem_number, sf_record_id: row.sf_record_id, is_closed: bool(row.is_closed),
    })),
    hedge_swap_hedges: source.swap_hedges.map((row) => ({
      ...common(row, profileByEmail),
      trade_date: isoDate(row.trade_date), product: row.product, direction: row.direction, swap_month: row.swap_month,
      quantity: number(row.quantity), unit: row.unit, price: number(row.price), venue: row.venue, broker: row.broker,
      counterparty: row.counterparty, notes: row.notes, is_expired: bool(row.is_expired), round_trip: bool(row.round_trip),
      initial_margin: number(row.initial_margin), current_margin: number(row.current_margin), pricing_basis: row.pricing_basis,
      bal_start_date: isoDate(row.bal_start_date), trade_type: row.trade_type,
      leg1_month: row.leg1_month, leg1_price: number(row.leg1_price), leg1_basis: row.leg1_basis, leg1_bal_date: isoDate(row.leg1_bal_date),
      leg2_month: row.leg2_month, leg2_price: number(row.leg2_price), leg2_basis: row.leg2_basis, leg2_bal_date: isoDate(row.leg2_bal_date),
      sf_record_id: row.sf_record_id,
    })),
    hedge_market_prices: source.mops_prices.map((row) => ({
      ...common(row, profileByEmail), price_date: isoDate(row.price_date), s380: number(row.s380), s05: number(row.s05), sgo: number(row.sgo),
      source: row.source, raw_input: row.raw_input, is_estimate: bool(row.is_estimate),
    })),
    hedge_clearing_entries: source.clearing_accounts.map((row) => ({
      ...common(row, profileByEmail), entry_date: isoDate(row.date), type: row.type, amount: number(row.amount), notes: row.notes, status: row.status || 'confirmed',
    })),
    hedge_invoices: source.invoices.map((row) => ({
      ...common(row, profileByEmail), invoice_number: row.invoice_number, invoice_type: row.invoice_type, issue_date: isoDate(row.issue_date),
      settlement_month: row.settlement_month, counterparty: row.counterparty, section: row.section, subtotal: number(row.subtotal),
      status: row.status, notes: row.notes, email_sent_at: isoTimestamp(row.email_sent_at), email_sent_to: row.email_sent_to,
      email_sent_cc: row.email_sent_cc, pdf_payload: row.pdf_payload, pdf_data_url: row.pdf_data_url,
    })),
    hedge_counterparties: source.counterparties.map((row) => ({
      ...common(row, profileByEmail), short_name: row.short_name, full_name: row.full_name, address_line1: row.address_line1,
      address_line2: row.address_line2, address_line3: row.address_line3, attention: row.attention, emails: row.emails,
      bank_name: row.bank_name, bank_swift: row.bank_swift, intermediary_bank: row.intermediary_bank,
      intermediary_swift: row.intermediary_swift, account_number: row.account_number, notes: row.notes,
    })),
    hedge_settings: source.app_configs.filter((row) => row.key !== 'google_auth').map((row) => ({
      ...common(row, profileByEmail), key: row.key, value: cleanLegacySetting(row.value || {}), label: row.label, notes: row.notes,
    })),
    hedge_integration_operations: source.integration_operations.map((row) => ({
      legacy_source_id: String(row.id), idempotency_key: `legacy:${row.idempotency_key}`, operation: row.operation,
      actor_user_id: actorIdFor(row.actor_email, profileByEmail), actor_email: normalizedEmail(row.actor_email) || 'legacy',
      request_hash: row.request_hash, status: row.status, response: row.response, error: row.error,
      created_date: isoTimestamp(row.created_date) || new Date().toISOString(), updated_date: isoTimestamp(row.updated_date) || new Date().toISOString(),
      expires_at: isoTimestamp(row.expires_at) || new Date().toISOString(),
    })),
    hedge_health_history: source.integration_health.map((row) => ({
      legacy_source_id: String(row.id), service_key: String(row.id), label: row.label, category: row.category,
      status: row.status, detail: row.detail, checked_at: isoTimestamp(row.checked_at) || new Date().toISOString(),
      latency_ms: number(row.latency_ms), metadata: row.metadata || {}, imported: true,
      created_at: isoTimestamp(row.created_date) || new Date().toISOString(),
    })),
    hedge_events: source.audit_logs.map((row) => ({
      legacy_source_id: String(row.id), event_type: row.action || 'legacy_event', entity_type: row.entity || 'Unknown',
      entity_legacy_id: row.record_id || null, label: row.label, before_data: row.before, after_data: row.after,
      actor_user_id: actorIdFor(row.user || row.created_by, profileByEmail), actor_email: normalizedEmail(row.user || row.created_by) || null,
      source: 'fc-hedge-desk', created_at: isoTimestamp(row.created_date) || new Date().toISOString(),
      metadata: { imported: true },
    })),
  };
}

async function importSettings(target, rows) {
  for (const row of rows) {
    const existing = await target.from('hedge_settings').select('id').eq('key', row.key).maybeSingle();
    if (existing.error) throw new Error(`Hedge setting ${row.key} lookup failed: ${existing.error.message}`);
    const result = existing.data
      ? await target.from('hedge_settings').update({ ...row, legacy_source_id: row.legacy_source_id }).eq('id', existing.data.id)
      : await target.from('hedge_settings').insert(row);
    if (result.error) throw new Error(`Hedge setting ${row.key} import failed: ${result.error.message}`);
  }
}

async function idMap(target, table) {
  const rows = await allRows(target, table, 'id,legacy_source_id');
  return new Map(rows.filter((row) => row.legacy_source_id).map((row) => [String(row.legacy_source_id), row.id]));
}

async function replaceLinks(target, table, parentField, parentId, rows) {
  const removed = await target.from(table).delete().eq(parentField, parentId);
  if (removed.error) throw new Error(`${table} cleanup failed: ${removed.error.message}`);
  if (!rows.length) return;
  const inserted = await target.from(table).insert(rows);
  if (inserted.error) throw new Error(`${table} import failed: ${inserted.error.message}`);
}

async function importRelationships(target, source) {
  const [physicalIds, swapIds, invoiceIds] = await Promise.all([
    idMap(target, 'hedge_physical_trades'), idMap(target, 'hedge_swap_hedges'), idMap(target, 'hedge_invoices'),
  ]);
  for (const swap of source.swap_hedges) {
    const swapId = swapIds.get(String(swap.id));
    const ids = [...new Set(array(swap.physical_trade_ids).map((id) => physicalIds.get(String(id))).filter(Boolean))];
    if (ids.length !== new Set(array(swap.physical_trade_ids).map(String)).size) throw new Error(`Swap ${swap.id} contains an unmatched physical trade link.`);
    await replaceLinks(target, 'hedge_swap_physical_links', 'swap_id', swapId, ids.map((physicalId, index) => ({ swap_id: swapId, physical_trade_id: physicalId, link_order: index })));
  }
  for (const invoice of source.invoices) {
    const invoiceId = invoiceIds.get(String(invoice.id));
    const lineRows = array(invoice.line_items).map((line, index) => ({
      invoice_id: invoiceId, line_order: index, product: line.product || null, direction: line.direction || null,
      quantity: number(line.quantity), unit: line.unit || null, price: number(line.price), mtm_avg: number(line.mtm_avg ?? line.mtmAvg),
      mtm_value: number(line.mtm_value ?? line.mtmValue), handling_fee: number(line.handling_fee ?? line.handlingFee),
      net_value: number(line.net_value ?? line.netValue), source_snapshot: line,
    }));
    await replaceLinks(target, 'hedge_invoice_lines', 'invoice_id', invoiceId, lineRows);
    const invoiceSwapIds = [...new Set(array(invoice.swap_ids).map((id) => swapIds.get(String(id))).filter(Boolean))];
    if (invoiceSwapIds.length !== new Set(array(invoice.swap_ids).map(String)).size) throw new Error(`Invoice ${invoice.id} contains an unmatched paper hedge link.`);
    await replaceLinks(target, 'hedge_invoice_swaps', 'invoice_id', invoiceId, invoiceSwapIds.map((swapId, index) => ({ invoice_id: invoiceId, swap_id: swapId, link_order: index })));
    const invoicePhysicalIds = [...new Set(array(invoice.physical_trade_ids).map((id) => physicalIds.get(String(id))).filter(Boolean))];
    if (invoicePhysicalIds.length !== new Set(array(invoice.physical_trade_ids).map(String)).size) throw new Error(`Invoice ${invoice.id} contains an unmatched physical trade link.`);
    await replaceLinks(target, 'hedge_invoice_physicals', 'invoice_id', invoiceId, invoicePhysicalIds.map((physicalId, index) => ({ invoice_id: invoiceId, physical_trade_id: physicalId, link_order: index })));
  }
}

async function importSfs(target, source, profileByEmail) {
  await upsertRows(target, 'hedge_month_closes', source.sfs_month_closes.map((row) => ({
    legacy_source_id: String(row.id), report_month: row.report_month, revision: row.revision, input_fingerprint: row.input_fingerprint,
    status: row.status, snapshot_json: row.snapshot_json, finalized_at: row.finalized_at, finalized_by: row.finalized_by,
    finalized_by_id: actorIdFor(row.finalized_by, profileByEmail), approved_at: row.approved_at, approved_by: row.approved_by,
    approved_by_id: actorIdFor(row.approved_by, profileByEmail), sent_at: row.sent_at,
    created_date: row.created_date, updated_date: row.updated_date,
  })));
  const closeIds = await idMap(target, 'hedge_month_closes');
  await upsertRows(target, 'hedge_report_deliveries', source.sfs_report_deliveries.map((row) => ({
    legacy_source_id: String(row.id), close_id: closeIds.get(String(row.close_id)), recipient: row.recipient,
    status: row.status, attempt_count: row.attempt_count, last_attempt_at: row.last_attempt_at, sent_at: row.sent_at,
    graph_message_id: row.graph_message_id, graph_request_id: row.graph_request_id, last_error: row.last_error,
    created_date: row.created_date, updated_date: row.updated_date,
  })));
}

async function bootstrapGraphEmailRouting(target, actor) {
  const configured = {
    operational: normalizedEmail(process.env.FCOS_GRAPH_BOOTSTRAP_OPERATIONAL_MAILBOX),
    updates: normalizedEmail(process.env.FCOS_GRAPH_BOOTSTRAP_UPDATES_MAILBOX),
    hedge: normalizedEmail(process.env.FCOS_GRAPH_BOOTSTRAP_HEDGE_MAILBOX),
  };
  const missing = Object.entries(configured).filter(([, email]) => !email).map(([key]) => key);
  if (missing.length) throw new Error(`Graph sender bootstrap requires configured ${missing.join(', ')} mailbox value(s).`);

  const mailboxIds = {};
  for (const [key, emailAddress] of Object.entries(configured)) {
    const existing = await target.from('email_sender_mailboxes').select('*').eq('email_address', emailAddress).maybeSingle();
    if (existing.error) throw new Error(`Graph mailbox lookup failed: ${existing.error.message}`);
    if (existing.data) {
      mailboxIds[key] = existing.data.id;
      continue;
    }
    const saved = await target.rpc('save_email_sender_mailbox', {
      p_mailbox_id: null,
      p_email_address: emailAddress,
      p_label: key === 'updates' ? 'FCOS Updates sender' : key === 'hedge' ? 'Hedge Desk sender' : 'Operational email sender',
      p_active: true,
      p_reason: 'Bootstrap existing Microsoft Graph sender during Hedge Desk cutover.',
      p_actor_user_id: actor.id,
      p_actor_email: actor.email,
      p_expected_revision: null,
    });
    if (saved.error) throw new Error(`Graph mailbox bootstrap failed: ${saved.error.message}`);
    mailboxIds[key] = saved.data.id;
  }

  const assignment = {
    payment_reminders: mailboxIds.operational,
    outstanding_invoice_reports: mailboxIds.operational,
    incoming_payment_reports: mailboxIds.operational,
    growth_coaching: mailboxIds.operational,
    fcos_updates: mailboxIds.updates,
    hedge_settlement: mailboxIds.hedge,
    hedge_sfs_reports: mailboxIds.hedge,
  };
  const routesResult = await target.from('email_sender_routes').select('*').order('purpose_key', { ascending: true });
  if (routesResult.error) throw new Error(`Graph email routes could not be loaded: ${routesResult.error.message}`);
  const routes = routesResult.data || [];
  for (const route of routes) {
    const mailboxId = assignment[route.purpose_key];
    if (!mailboxId || route.mailbox_id === mailboxId) continue;
    const saved = await target.rpc('save_email_sender_route', {
      p_purpose_key: route.purpose_key,
      p_mailbox_id: mailboxId,
      p_reason: 'Assign existing Microsoft Graph sender during Hedge Desk cutover.',
      p_actor_user_id: actor.id,
      p_actor_email: actor.email,
      p_expected_revision: route.revision,
    });
    if (saved.error) throw new Error(`Graph route ${route.purpose_key} could not be assigned: ${saved.error.message}`);
  }
  return { mailboxCount: new Set(Object.values(configured)).size, purposeCount: Object.keys(assignment).length };
}

async function listStorageObjects(storage, prefix = '') {
  const found = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await storage.list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (result.error) throw new Error(`Storage path ${prefix || '/'} could not be listed: ${result.error.message}`);
    for (const item of result.data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) found.push({ ...item, path });
      else found.push(...await listStorageObjects(storage, path));
    }
    if ((result.data || []).length < PAGE_SIZE) return found;
  }
}

async function migrateFiles(source, target, invoiceIds, { apply }) {
  const objects = await listStorageObjects(source.storage.from(SOURCE_BUCKET));
  const checks = [];
  for (const object of objects) {
    const legacyInvoiceId = object.path.split('/')[0];
    const invoiceId = invoiceIds.get(legacyInvoiceId);
    if (!invoiceId) throw new Error(`Storage object ${object.path} has no matching invoice.`);
    const downloaded = await source.storage.from(SOURCE_BUCKET).download(object.path);
    if (downloaded.error) throw new Error(`Storage object ${object.path} could not be downloaded: ${downloaded.error.message}`);
    const buffer = Buffer.from(await downloaded.data.arrayBuffer());
    const checksum = sha256(buffer);
    const targetPath = `migrated/invoices/${invoiceId}/${object.name}`;
    if (apply) {
      const uploaded = await target.storage.from(TARGET_BUCKET).upload(targetPath, buffer, { contentType: object.metadata?.mimetype || 'application/pdf', upsert: true });
      if (uploaded.error) throw new Error(`Storage object ${targetPath} could not be uploaded: ${uploaded.error.message}`);
      const verified = await target.storage.from(TARGET_BUCKET).download(targetPath);
      if (verified.error) throw new Error(`Storage object ${targetPath} could not be verified: ${verified.error.message}`);
      const targetBuffer = Buffer.from(await verified.data.arrayBuffer());
      if (targetBuffer.length !== buffer.length || sha256(targetBuffer) !== checksum) throw new Error(`Storage checksum mismatch for ${targetPath}.`);
      const metadata = await target.from('hedge_documents').upsert({
        legacy_source_id: `${SOURCE_BUCKET}:${object.path}`, invoice_id: invoiceId, bucket: TARGET_BUCKET, storage_path: targetPath,
        display_name: object.name, mime_type: object.metadata?.mimetype || 'application/pdf', size_bytes: buffer.length,
        sha256: checksum, created_at: object.created_at || new Date().toISOString(), created_by_email: 'migration',
      }, { onConflict: 'legacy_source_id' });
      if (metadata.error) throw new Error(`Document metadata for ${object.path} could not be saved: ${metadata.error.message}`);
    }
    checks.push({ sourcePath: object.path, targetPath, size: buffer.length, sha256: checksum });
  }
  return checks;
}

async function targetImportedRows(target, table) {
  const rows = await allRows(target, table);
  return rows.filter((row) => row.legacy_source_id);
}

async function reconciliation(target, source, fileChecks) {
  const [physicals, swaps, prices, clearing, invoices, counterparties, swapLinks, lines, invoiceSwaps, invoicePhysicals, closes, deliveries, documents] = await Promise.all([
    targetImportedRows(target, 'hedge_physical_trades'), targetImportedRows(target, 'hedge_swap_hedges'),
    targetImportedRows(target, 'hedge_market_prices'), targetImportedRows(target, 'hedge_clearing_entries'),
    targetImportedRows(target, 'hedge_invoices'), targetImportedRows(target, 'hedge_counterparties'),
    allRows(target, 'hedge_swap_physical_links', '*', 'swap_id'), allRows(target, 'hedge_invoice_lines', '*', 'invoice_id'),
    allRows(target, 'hedge_invoice_swaps', '*', 'invoice_id'), allRows(target, 'hedge_invoice_physicals', '*', 'invoice_id'),
    targetImportedRows(target, 'hedge_month_closes'),
    targetImportedRows(target, 'hedge_report_deliveries'), targetImportedRows(target, 'hedge_documents'),
  ]);
  const checks = {
    counts: {
      physicalTrades: [source.physical_trades.length, physicals.length], swaps: [source.swap_hedges.length, swaps.length],
      marketPrices: [source.mops_prices.length, prices.length], clearingEntries: [source.clearing_accounts.length, clearing.length],
      invoices: [source.invoices.length, invoices.length], counterparties: [source.counterparties.length, counterparties.length],
      monthCloses: [source.sfs_month_closes.length, closes.length], reportDeliveries: [source.sfs_report_deliveries.length, deliveries.length],
      documents: [fileChecks.length, documents.length],
    },
    relationships: {
      swapPhysicalLinks: [source.swap_hedges.reduce((total, row) => total + new Set(array(row.physical_trade_ids).map(String)).size, 0), swapLinks.length],
      invoiceLines: [source.invoices.reduce((total, row) => total + array(row.line_items).length, 0), lines.length],
      invoiceSwaps: [source.invoices.reduce((total, row) => total + new Set(array(row.swap_ids).map(String)).size, 0), invoiceSwaps.length],
      invoicePhysicals: [source.invoices.reduce((total, row) => total + new Set(array(row.physical_trade_ids).map(String)).size, 0), invoicePhysicals.length],
    },
    financials: {
      invoiceSubtotal: [sum(source.invoices, 'subtotal'), sum(invoices, 'subtotal')],
      clearingAmount: [sum(source.clearing_accounts, 'amount'), sum(clearing, 'amount')],
      swapQuantity: [sum(source.swap_hedges, 'quantity'), sum(swaps, 'quantity')],
    },
  };
  const mismatches = [];
  for (const [group, values] of Object.entries(checks)) {
    for (const [name, pair] of Object.entries(values)) if (pair[0] !== pair[1]) mismatches.push(`${group}.${name}: ${pair[0]} != ${pair[1]}`);
  }
  return { ...checks, mismatches, verified: mismatches.length === 0 };
}

async function main() {
  const sourceUrl = required('HEDGE_SOURCE_SUPABASE_URL');
  const source = client('HEDGE_SOURCE_SUPABASE_URL', 'HEDGE_SOURCE_SUPABASE_SERVICE_ROLE_KEY');
  const target = client('FCOS_TARGET_SUPABASE_URL', 'FCOS_TARGET_SUPABASE_SERVICE_ROLE_KEY');
  const sourceData = await loadSource(source);
  const profiles = await allRows(target, 'user_profiles', 'id,email,full_name,user_type,active');
  const migrationActor = await activeGeneralManager(target, profiles);
  const sourceEmails = sourceActiveUsers(sourceData.app_configs);
  if (!sourceEmails.length) throw new Error('No active Hedge Desk users were found in the source Google access configuration.');
  const reviewedIdentityOverrides = identityOverrides();
  const profileByEmail = assertIdentityMapping(sourceEmails, profiles, reviewedIdentityOverrides);
  const mapped = mappedRows(sourceData, profileByEmail);
  const summary = {
    mode: MODE,
    sourceProjectRef: sourceProjectRef(sourceUrl),
    sourceUserCount: sourceEmails.length,
    matchedUserCount: sourceEmails.length,
    reviewedIdentityOverrideCount: reviewedIdentityOverrides.size,
    sourceCounts: Object.fromEntries(Object.entries(sourceData).map(([key, rows]) => [key, rows.length])),
    financials: {
      invoiceSubtotal: sum(sourceData.invoices, 'subtotal'),
      clearingAmount: sum(sourceData.clearing_accounts, 'amount'),
      swapQuantity: sum(sourceData.swap_hedges, 'quantity'),
    },
  };
  if (!APPLY && !VERIFY_ONLY) {
    const sourceFiles = await listStorageObjects(source.storage.from(SOURCE_BUCKET));
    console.log(JSON.stringify({ ...summary, sourceFiles: sourceFiles.length }, null, 2));
    return;
  }

  let migrationRun = null;
  if (!VERIFY_ONLY) {
    const started = await target.from('hedge_migration_runs').insert({
      source_project_ref: summary.sourceProjectRef,
      source_commit: process.env.HEDGE_SOURCE_COMMIT || null,
      mode: MODE,
      status: 'running',
      table_counts: summary.sourceCounts,
      actor_user_id: migrationActor.id,
      actor_email: migrationActor.email,
    }).select('id').single();
    if (started.error) throw new Error(`Migration run could not be started: ${started.error.message}`);
    migrationRun = started.data;
  }

  try {
    let emailRouting = null;
    if (!VERIFY_ONLY) {
      for (const [table, rows] of Object.entries(mapped)) {
        if (table === 'hedge_settings') await importSettings(target, rows);
        else if (table === 'hedge_events') await upsertRows(target, table, rows, 'legacy_source_id', { ignoreDuplicates: true });
        else await upsertRows(target, table, rows);
      }
      await importRelationships(target, sourceData);
      await importSfs(target, sourceData, profileByEmail);
      emailRouting = await bootstrapGraphEmailRouting(target, migrationActor);
    }
    const invoiceIds = await idMap(target, 'hedge_invoices');
    const fileChecks = await migrateFiles(source, target, invoiceIds, { apply: !VERIFY_ONLY });
    const result = await reconciliation(target, sourceData, fileChecks);
    if (!result.verified) throw new Error(`Migration reconciliation failed: ${result.mismatches.join('; ')}`);
    if (migrationRun) {
      const completed = await target.from('hedge_migration_runs').update({
        status: 'verified', storage_counts: { files: fileChecks.length }, reconciliation: result, completed_at: new Date().toISOString(),
      }).eq('id', migrationRun.id);
      if (completed.error) throw new Error(`Migration run could not be finalized: ${completed.error.message}`);
    }
    console.log(JSON.stringify({ ...summary, reconciliation: result, storageFiles: fileChecks.length, emailRouting }, null, 2));
  } catch (error) {
    if (migrationRun) await target.from('hedge_migration_runs').update({ status: 'failed', error: String(error.message || error).slice(0, 2000), completed_at: new Date().toISOString() }).eq('id', migrationRun.id);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
